import test from 'node:test';
import assert from 'node:assert/strict';
import { researchKey, matchesName, sourceType, searchSerper, readSourcePage, corroboratedFacts, getSerperResearch } from '../src/services/ai/serperResearch.js';
import { generateCatalogCopy } from '../src/services/ai/catalogDescriptions.js';
const name = 'ASICS GEL-Kayano 20 GTX Dark Grey Black';
const url = 'https://prom.ua/example';
const product = { name, description: 'Матеріал: шкіра, текстиль' };

test('model matching preserves generation, modification and colour, tolerating punctuation', () => {
  assert.equal(matchesName(name, 'Купити ASICS GEL KAYANO 20 Gore-Tex Dark Gray Black 42'), true);
  for (const title of [name.replace('20', '21'), name.replace(' GTX', ''), name.replace('Dark Grey', 'Orange'), `${name} Winter`, `${name} термо`, `${name} White`])
    assert.equal(matchesName(name, title), false);
  assert.equal(researchKey(name), researchKey(name.toLowerCase()));
  assert.notEqual(researchKey(name), researchKey(name.replace('GTX', 'Fur')));
});
test('Serper gets only the name and its own key, not supplier text or customer data', async () => {
  let request;
  await searchSerper(name, { apiKey: 'secret', fetchImpl: async (url, options) => {
    request = { url, options }; return { ok: true, json: async () => ({ organic: [], credits: 1 }) };
  } });
  assert.equal(request.url, 'https://google.serper.dev/search');
  assert.equal(request.options.headers['X-API-KEY'], 'secret');
  assert.equal(JSON.parse(request.options.body).q, `"${name}"`);
  await assert.rejects(searchSerper(name, { apiKey: 'secret', fetchImpl: async () => ({ ok: false, status: 429 }) }), { message: 'Serper HTTP 429', provider: 'serper' });
});
test('source requests reject arbitrary hosts and cross-domain private redirects', async () => {
  for (const url of ['http://asics.com', 'https://127.0.0.1', 'https://asics.com.evil.test', 'https://key@asics.com', 'https://asics.com:444']) assert.equal(sourceType(url), null);
  assert.equal(sourceType('https://www.asics.com/shoe'), 'manufacturer_reference');
  let calls = 0;
  await assert.rejects(readSourcePage(url, { fetchImpl: async () => {
    calls++; return { status: 302, headers: new Headers({ location: 'https://localhost/' }) };
  } }), /Unapproved/);
  assert.equal(calls, 1);
});
test('only basic supplier materials corroborated on fetched matching pages are eligible', () => {
  const pages = [{ url, materialEvidence: 'Матеріал: шкіра та текстиль, GORE-TEX' }];
  assert.equal(corroboratedFacts('текстиль', pages).length, 1);
  assert.equal(corroboratedFacts('текстиль', pages)[0].value, 'текстиль');
  assert.equal(corroboratedFacts('шкіра', [{ url, snippet: 'шкіра' }]).length, 0);
  assert.equal(corroboratedFacts('екошкіра', pages).length, 0);
  assert.equal(corroboratedFacts('шкіра', [{ url, materialEvidence: 'штучна шкіра' }]).length, 0);
  assert.equal(corroboratedFacts('GORE-TEX', pages).length, 0);
});
function database() {
  const store = new Map();
  return { collection: collection => ({
    findOne: async filter => store.get(`${collection}:${filter._id}`),
    updateOne: async (filter, update) => {
      const key = `${collection}:${filter._id}`, previous = store.get(key) || {};
      store.set(key, { ...previous, ...update.$set,
        ...(update.$inc ? { requests: (previous.requests || 0) + update.$inc.requests } : {}) });
    },
  }) };
}
test('research persists name cache, prioritizes official sources, and never repeats search for another size', async () => {
  const db = database(); let calls = 0; const read = [];
  const options = {
    search: async () => { calls++; return { credits: 1, results: [
      { url, title: name }, { url: 'https://asics.com/shoe', title: name },
      { url: 'https://prom.ua/wrong', title: name.replace('20', '21') },
    ] }; },
    readPage: async url => { read.push(url); return { url, title: name, text: `${name} Матеріал: текстиль` }; },
  };
  const first = await getSerperResearch(product, db, options);
  const second = await getSerperResearch({ ...product, sizes: [42] }, db, options);
  assert.equal(calls, 1); assert.equal(read[0], 'https://asics.com/shoe');
  assert.equal(first.approvedFacts.length, 1); assert.equal(second.cacheHit, true); assert.equal(second.credits, 0);
});
test('empty searches are cached and unverified snippets cannot become writer facts', async () => {
  const db = database(); let searches = 0;
  const options = { search: async () => { searches++; return { credits: 1, results: [{ url, title: 'Different model', snippet: 'шкіра' }] }; },
    readPage: () => assert.fail('wrong model must not be fetched') };
  const result = await getSerperResearch(product, db, options);
  await getSerperResearch(product, db, options);
  assert.equal(searches, 1); assert.equal(result.match, 'unconfirmed'); assert.deepEqual(result.approvedFacts, []);
});
test('Gemini receives structured research evidence without enabling Google Grounding', async () => {
  let body;
  const searchEvidence = { match: 'name_matched', approvedFacts: [{ attribute: 'supplier_material', value: 'текстиль' }] };
  await generateCatalogCopy(product, { apiKey: 'gemini-secret', searchEvidence, fetchImpl: async (url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
      description: `${name} — кросівки у темно-сірому та чорному кольорах. За даними постачальника, верх виконано з текстилю. Таку пару можна поєднати з джинсами.`, highlights: [], missingFacts: [],
    }) }] } }] }) };
  } });
  assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).searchEvidence, searchEvidence);
  assert.equal(body.tools, undefined);
});
