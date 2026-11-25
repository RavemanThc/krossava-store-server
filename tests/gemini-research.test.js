import test from 'node:test';
import assert from 'node:assert/strict';
import { researchProduct } from '../src/services/ai/productResearch.js';
import { generateProductDescription } from '../src/services/ai/productDescription.js';
const product = { name: 'ASICS Test GTX', description: 'Шкіра, термо' };
const sources = [{ web: { title: 'Shop', uri: 'https://example.com/shoe' } }];
const response = (match, chunks = sources, conflicts = []) => async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ match, summary: 'Стриманий дизайн.', conflicts }) }] }, groundingMetadata: { groundingChunks: chunks } }] }) });
test('research accepts external context only for an exact grounded match without conflicts', async () => {
 for (const [match, chunks, conflicts, usable] of [['exact', sources, [], true], ['uncertain', sources, [], false], ['exact', [], [], false], ['exact', sources, ['Different material'], false]]) {
  const result = await researchProduct(product, { apiKey: 'x', fetchImpl: response(match, chunks, conflicts) });
  assert.equal(result.usable, usable);assert.equal(Boolean(result.summary), usable);
 }
});
test('rejects malformed and ungrounded source URLs', async () => {
 const result = await researchProduct(product, { apiKey: 'x', fetchImpl: response('exact', [{ web: { uri: 'javascript:alert(1)' } }]) });
 assert.equal(result.usable, false);assert.deepEqual(result.sources, []);
 await assert.rejects(researchProduct(product, { apiKey: 'x', fetchImpl: async () => ({ ok: false, status: 403 }) }), /Gemini research HTTP 403/);
});
test('description does not consume research from an uncertain match', async () => {
 let body;
 await generateProductDescription(product, { apiKey: 'x', research: { usable: false, summary: 'UNVERIFIED', sources: [{}] }, fetchImpl: async (_, request) => {
  body=request.body;
  return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ description: 'Шкіряне взуття.', highlights: ['Шкіра'], missingFacts: [] }) }] } }] }) };
 } });
 assert.doesNotMatch(body, /UNVERIFIED/);
});
