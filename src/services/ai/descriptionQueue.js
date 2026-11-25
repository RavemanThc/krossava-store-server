import { getSerperResearch } from './serperResearch.js';
import { randomUUID } from 'node:crypto';
import { descriptionHtml, generateCatalogCopy, sourceIdentity, supplierSource, COPY_VERSION } from './catalogDescriptions.js';

const numberOption = (value, fallback, max) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error('Invalid description worker limit');
  return n;
};
export const workerOptions = () => ({
  dailyLimit: numberOption(process.env.GEMINI_DESCRIPTION_DAILY_LIMIT, 2000, 10000),
  intervalMs: numberOption(process.env.GEMINI_DESCRIPTION_INTERVAL_MS, 10000, 3600000),
});

// A MongoDB lease serializes workers across web replicas and CLI invocations.
export async function descriptionStep(db, { productId, generate = generateCatalogCopy, research = getSerperResearch, syncSearch, dailyLimit = 2000 } = {}) {
  const products = db.collection('products');
  const jobs = db.collection('catalog_description_jobs');
  const control = db.collection('catalog_description_control');
  const owner = randomUUID();
  const now = new Date();
  try {
    const lease = await control.findOneAndUpdate({ _id: 'worker', until: { $lte: now } },
      { $set: { owner, until: new Date(Date.now() + 600000) } }, { upsert: true, returnDocument: 'after' });
    if (lease?.owner !== owner) return { status: 'busy' };
  } catch (error) { if (error.code === 11000) return { status: 'busy' }; throw error; }
  try {
    // Retry search delivery independently; do not pay for regeneration after replication errors.
    const pendingSearch = await products.find({ 'aiDescription.searchPending': true }).limit(25).toArray();
    if (pendingSearch.length && syncSearch) {
      try {
        await syncSearch(pendingSearch);
        for (const p of pendingSearch) await products.updateOne({ _id: p._id, description: p.description,
          'aiDescription.sourceHash': p.aiDescription.sourceHash }, { $set: { 'aiDescription.searchPending': false } });
      } catch { return { status: 'search_unavailable' }; }
    }
    const pause = await control.findOne({ _id: 'pause' });
    if (pause?.until > now) return { status: 'paused', until: pause.until, reason: pause.reason };

    // The catalogue itself is the durable discovery queue, so any import/create path is covered.
    const cursor = products.find(productId ? { _id: productId } : {}, { projection: { name: 1, description: 1, supplierDescription: 1, aiDescription: 1 } }).sort({ _id: 1 });
    let selected;
    for await (const product of cursor) {
      const identity = sourceIdentity(product);
      if (!identity.facts.name || !identity.facts.supplierDescription) continue;
      if (product.aiDescription?.sourceHash === identity.hash && product.description === product.aiDescription.text) continue;
      const job = await jobs.findOne({ _id: identity.hash });
      if (job?.status === 'failed' || job?.retryAt > now) continue;
      selected = { product, ...identity, job }; break;
    }
    await cursor.close();
    if (!selected) return { status: 'idle' };
    const { product, hash, facts } = selected;
    let job = selected.job;
    if (job?.status !== 'ready') {
      const day = new Date().toISOString().slice(0, 10);
      const budget = await control.findOne({ _id: `budget:${day}` });
      if ((budget?.requests || 0) >= dailyLimit) return { status: 'daily_limit', requests: budget.requests };
      await jobs.updateOne({ _id: hash }, { $setOnInsert: { source: facts, version: COPY_VERSION, createdAt: now },
        $set: { status: 'processing', startedAt: now }, $inc: { attempts: 1 } }, { upsert: true });
      try {
        const searchEvidence = await research({ ...product, description: supplierSource(product) }, db);
        await jobs.updateOne({ _id: hash }, { $set: { research: searchEvidence } });
        // Search results survive a Gemini outage; reserve Gemini quota only when actually sending.
        await control.updateOne({ _id: `budget:${day}` }, { $inc: { requests: 1 } }, { upsert: true });
        const result = await generate(product, { searchEvidence });
        job = { status: 'ready', text: descriptionHtml(result.draft.description), plainText: result.draft.description,
          research: searchEvidence, model: result.model, usage: result.usage, generatedAt: new Date() };
        await jobs.updateOne({ _id: hash }, { $set: job, $unset: { retryAt: '', error: '' } });
      } catch (error) {
        const attempts = (selected.job?.attempts || 0) + 1;
        const status = error.status;
        const reason = status ? `${error.provider === 'serper' ? 'SERPER_' : ''}HTTP_${status}` : 'generation_or_validation_failed';
        const servicePause = [400, 401, 403, 404, 429].includes(status);
        const retryAt = new Date(Date.now() + (servicePause ? 6 * 3600000 : 5 * 60000));
        await jobs.updateOne({ _id: hash }, { $set: { status: !servicePause && !(status >= 500) && attempts >= 3 ? 'failed' : 'pending', error: reason, retryAt } });
        if (servicePause || status >= 500) await control.updateOne({ _id: 'pause' },
          { $set: { reason, until: retryAt } }, { upsert: true });
        return { status: 'deferred', reason, retryAt, productId: String(product._id) };
      }
    }
    // Compare-and-set prevents overwriting edits/imports that happened during generation.
    const update = await products.updateOne({ _id: product._id, name: product.name,
      description: product.description, supplierDescription: Object.hasOwn(product, 'supplierDescription') ? product.supplierDescription : { $exists: false } },
    { $set: { supplierDescription: supplierSource(product), description: job.text, updatedAt: new Date(),
      aiDescription: { text: job.text, sourceHash: hash, version: COPY_VERSION, model: job.model,
        generatedAt: job.generatedAt, researchKey: job.research?.cacheKey, searchPending: true } } });
    return { status: update.matchedCount ? 'applied' : 'source_changed', productId: String(product._id), cached: selected.job?.status === 'ready' };
  } finally {
    await control.updateOne({ _id: 'worker', owner }, { $set: { until: new Date(0) } });
  }
}

export function startDescriptionWorker(db, { syncSearch, log = console.log } = {}) {
  if (process.env.GEMINI_DESCRIPTIONS_ENABLED === 'false' || !(process.env.GEMINIDESCRIPTIONAPI || process.env.GEMINI_API_KEY)) return () => {};
  if (!(process.env.SERPERAPI || process.env.SERPER_API_KEY)) { log('Description worker disabled: missing Serper key.'); return () => {}; }
  let options;
  try { options = workerOptions(); }
  catch { log('Description worker disabled: invalid request limits.'); return () => {}; }
  let stopped = false;
  let timer;
  const tick = async () => {
    let delay = options.intervalMs;
    try {
      const result = await descriptionStep(db, { ...options, syncSearch });
      if (!['idle', 'busy', 'paused', 'daily_limit'].includes(result.status)) log(JSON.stringify({ descriptions: result }));
      if (result.status !== 'applied' && result.status !== 'source_changed') delay = Math.max(delay, 60000);
    } catch { log('Description worker unavailable; retrying in one minute.'); delay = 60000; }
    if (!stopped) { timer = setTimeout(tick, delay); timer.unref(); }
  };
  timer = setTimeout(tick, 1000); timer.unref();
  return () => { stopped = true; clearTimeout(timer); };
}
