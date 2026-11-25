import 'dotenv/config';
import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { descriptionStep, workerOptions } from '../src/services/ai/descriptionQueue.js';
import { sourceIdentity } from '../src/services/ai/catalogDescriptions.js';
import { syncSearchProducts } from '../src/services/search/sync.js';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false },
  watch: { type: 'boolean', default: false }, product: { type: 'string' }, limit: { type: 'string', default: '2000' } } });
let stop = false;
process.on('SIGTERM', () => { stop = true; });
process.on('SIGINT', () => { stop = true; });
try {
  if (values.product && !/^[a-f0-9]{24}$/i.test(values.product)) throw new Error('Invalid product');
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid limit');
  if (values.apply && !(process.env.GEMINIDESCRIPTIONAPI || process.env.GEMINI_API_KEY)) throw new Error('Missing Gemini key');
  if (values.apply && !(process.env.SERPERAPI || process.env.SERPER_API_KEY)) throw new Error('Missing Serper key');
  await mongoose.connect(process.env.MONGODB_URL, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  if (!values.apply) {
    const counts = { total: 0, ready: 0, missingSource: 0, pending: 0, failed: 0 };
    const failed = new Set((await db.collection('catalog_description_jobs').find({ status: 'failed' }, { projection: { _id: 1 } }).toArray()).map(j => j._id));
    for await (const product of db.collection('products').find({}, { projection: { name: 1, description: 1, supplierDescription: 1, aiDescription: 1 } })) {
      counts.total++;
      const { facts, hash } = sourceIdentity(product);
      if (!facts.name || !facts.supplierDescription) counts.missingSource++;
      else if (product.aiDescription?.sourceHash === hash && product.description === product.aiDescription.text) counts.ready++;
      else if (failed.has(hash)) counts.failed++;
      else counts.pending++;
    }
    console.log(JSON.stringify({ dryRun: true, ...counts,
      pause: await db.collection('catalog_description_control').findOne({ _id: 'pause' }) }));
  } else {
    const options = workerOptions();
    console.log(JSON.stringify({ pipeline: 'Serper → Gemini → MongoDB', model: process.env.GEMINI_DESCRIPTION_MODEL || 'gemini-3.1-flash-lite', dailyGeminiLimit: options.dailyLimit, dailySerperLimit: Number(process.env.SERPER_DAILY_LIMIT || 1000) }));
    let applied = 0;
    while (!stop && applied < limit) {
      const result = await descriptionStep(db, { ...options,
        productId: values.product ? new mongoose.Types.ObjectId(values.product) : undefined, syncSearch: syncSearchProducts });
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
      if (result.status === 'applied') applied++;
      if (values.product && result.status === 'idle') break;
      if (!values.watch && !['applied', 'source_changed'].includes(result.status)) break;
      if (values.product && applied) break;
      if (applied < limit) await sleep(['applied', 'source_changed'].includes(result.status) ? options.intervalMs : 60000);
    }
    // One bounded delivery flush after the last product, without any generation.
    const pending = await db.collection('products').find({ 'aiDescription.searchPending': true }).toArray();
    if (pending.length) {
      await syncSearchProducts(pending);
      for (const p of pending) await db.collection('products').updateOne({ _id: p._id, description: p.description,
        'aiDescription.sourceHash': p.aiDescription.sourceHash }, { $set: { 'aiDescription.searchPending': false } });
    }
  }
} catch { console.error('Description job stopped; check service access, configuration and durable queue status.'); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
