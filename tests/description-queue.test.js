import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionHtml, sourceIdentity, supplierSource, validateCatalogCopy } from '../src/services/ai/catalogDescriptions.js';
import { descriptionStep as runStep } from '../src/services/ai/descriptionQueue.js';
const descriptionStep = (db, options) => runStep(db, { research: async () => ({ cacheKey: 'test', approvedFacts: [] }), ...options });
import { stockUpdateOperations } from '../src/services/import/easydrop.js';
const product = { _id: 'p', groupId: 'g', name: 'ASICS Test Grey', description: '<p>Матеріал: текстиль</p>' };
const text = `${product.name} — кросівки у сірому кольорі. Верх виконаний із текстилю.\n\nСіру пару можна поєднати з темними джинсами або джогерами.`;
const hash = sourceIdentity(product).hash;
const generated = { ...product, supplierDescription: product.description, description: text,
  aiDescription: { text, sourceHash: hash } };

test('published paragraphs preserve layout and escape untrusted markup', () => {
  assert.equal(descriptionHtml('A & B\n\n<script>x</script>'), '<p>A &amp; B</p>\n<p>&lt;script&gt;x&lt;/script&gt;</p>');
});

test('supplier source survives generation; sizes/stock do not invalidate cache, modifications do', () => {
  assert.equal(supplierSource(generated), product.description);
  assert.equal(sourceIdentity(generated).hash, hash);
  assert.equal(sourceIdentity({ ...product, sizes: [42], price: 2 }).hash, hash);
  assert.notEqual(sourceIdentity({ ...product, name: product.name + ' GTX' }).hash, hash);
  assert.notEqual(sourceIdentity({ ...product, description: 'Шкіра' }).hash, hash);
  assert.equal(supplierSource({ ...generated, description: 'Overwritten by old importer' }), product.description);
});
test('XML atomically preserves AI copy, stores new supplier facts and escapes dollar strings', () => {
  const update = stockUpdateOperations([{ ...product, description: '$source', name: '$name' }])[0].updateOne.update[0].$set;
  assert.deepEqual(update.supplierDescription, { $literal: '$source' });
  assert.deepEqual(update.name, { $literal: '$name' });
  assert.equal(update.description.$cond[1], '$aiDescription.text');
  assert.deepEqual(update.description.$cond[2], { $literal: '$source' });
  assert.deepEqual(update.description.$cond[0].$and[0], { $eq: ['$name', { $literal: '$name' }] });
  assert.equal(update.aiDescription, undefined);
  assert.notEqual(sourceIdentity({ ...generated, supplierDescription: 'New material' }).hash, hash);
});
test('copy requires exact name and rejects unsupported technology and authenticity claims', () => {
  assert.equal(validateCatalogCopy(text, product.name), true);
  for (const claim of [' За даними постачальника, верх із текстилю.', ' Оригінальні кросівки.', ' Мембрана GORE-TEX.', ' Натуральна шкіра.', ' Комфорт протягом дня.', ' https://example.com'])
    assert.equal(validateCatalogCopy(text + claim, product.name), false);
  assert.equal(validateCatalogCopy(text.slice(10), product.name), false);
});

function fixture({ cached, requests = 0, matched = 1, item = product, searchPending = [] } = {}) {
  const calls = [];
  let scans = 0;
  const cursor = rows => ({ sort() { return this; }, limit() { return this; }, async toArray() { return rows; },
    async close() {}, async *[Symbol.asyncIterator]() { yield* rows; } });
  const collections = {
    products: { find: () => cursor(scans++ === 0 ? searchPending : [item]),
      updateOne: async (filter, update) => { calls.push({ collection: 'products', filter, update }); return { matchedCount: matched }; } },
    catalog_description_jobs: { findOne: async () => cached,
      updateOne: async (filter, update) => { calls.push({ collection: 'jobs', filter, update }); } },
    catalog_description_control: {
      findOneAndUpdate: async (filter, update) => ({ owner: update.$set.owner }),
      findOne: async filter => filter._id.startsWith('budget:') ? { requests } : null,
      updateOne: async (filter, update) => { calls.push({ collection: 'control', filter, update }); },
    },
  };
  return { db: { collection: name => collections[name] }, calls };
}
test('cached result is applied without API call and publication uses compare-and-set', async () => {
  const { db, calls } = fixture({ cached: { status: 'ready', text, model: 'gemini-test' } });
  const result = await descriptionStep(db, { generate: () => assert.fail('must not call Gemini') });
  assert.equal(result.status, 'applied'); assert.equal(result.cached, true);
  const write = calls.find(c => c.collection === 'products');
  assert.equal(write.filter.description, product.description);
  assert.equal(write.update.$set.supplierDescription, product.description);
  assert.equal(write.update.$set.aiDescription.searchPending, true);
});
test('quota failure pauses processing without changing product or losing original description', async () => {
  const { db, calls } = fixture();
  const result = await descriptionStep(db, { generate: async () => { throw Object.assign(new Error('secret'), { status: 429 }); } });
  assert.equal(result.reason, 'HTTP_429');
  assert.equal(calls.some(c => c.collection === 'products'), false);
  assert.equal(calls.some(c => c.filter._id === 'pause'), true);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);
});
test('daily budget prevents API requests; changed source prevents publication', async () => {
  const budget = fixture({ requests: 2000 });
  assert.equal((await descriptionStep(budget.db, { generate: () => assert.fail('budget exceeded') })).status, 'daily_limit');
  const changed = fixture({ matched: 0 });
  const result = await descriptionStep(changed.db, { generate: async () => ({ draft: { description: text }, model: 'gemini-test' }) });
  assert.equal(result.status, 'source_changed');
});

test('completed descriptions are not regenerated and exhausted jobs are skipped', async () => {
  for (const setup of [{ item: generated }, { cached: { status: 'failed' } }]) {
    const { db, calls } = fixture(setup);
    const result = await descriptionStep(db, { generate: () => assert.fail('must not regenerate') });
    assert.equal(result.status, 'idle');
    assert.equal(calls.some(c => c.collection === 'products'), false);
  }
});
test('search replication failures retain retry flag and do not spend Gemini quota', async () => {
  const { db, calls } = fixture({ searchPending: [generated] });
  const result = await descriptionStep(db, { generate: () => assert.fail('no Gemini'),
    syncSearch: async () => { throw new Error('search offline'); } });
  assert.equal(result.status, 'search_unavailable');
  assert.equal(calls.some(c => c.collection === 'products'), false);
});
test('a duplicate lock prevents concurrent generation', async () => {
  const result = await descriptionStep({ collection: () => ({ findOneAndUpdate: async () => {
    throw Object.assign(new Error('duplicate key'), { code: 11000 });
  } }) }, { generate: () => assert.fail('another worker owns the lease') });
  assert.equal(result.status, 'busy');
});

test('Serper quota failure pauses before Gemini and does not reserve Gemini requests', async () => {
  const { db, calls } = fixture();
  const result = await descriptionStep(db, {
    research: async () => { throw Object.assign(new Error('private key'), { status: 429, provider: 'serper' }); },
    generate: () => assert.fail('Serper must finish first'),
  });
  assert.equal(result.reason, 'SERPER_HTTP_429');
  assert.equal(calls.some(c => c.filter._id?.startsWith('budget:')), false);
  assert.equal(calls.some(c => c.collection === 'products'), false);
  assert.doesNotMatch(JSON.stringify(calls), /private key/);
});

test('temporary Gemini outages remain retryable after three attempts', async () => {
  const { db, calls } = fixture({ cached: { status: 'pending', attempts: 3 } });
  const result = await descriptionStep(db, { generate: async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); } });
  assert.equal(result.status, 'deferred');
  assert.equal(calls.find(c => c.collection === 'jobs' && c.update.$set?.error)?.update.$set.status, 'pending');
});

test('long single-paragraph copy is formatted without changing its words', () => {
  const input = 'Перше речення. Друге речення. Третє речення. Четверте речення. П’яте речення. Шосте речення.';
  const html = descriptionHtml(input);
  assert.equal((html.match(/<p>/g) || []).length, 3);
  assert.equal(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), input);
});
