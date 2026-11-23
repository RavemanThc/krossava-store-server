import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionFacts, generateProductDescription } from '../src/services/ai/productDescription.js';
const product = { name: 'ASICS Test', description: '<p>Шкіра, текстиль</p><script>secret()</script>', price: 2800, customer: 'private' };
const valid = { description: 'Верх зі шкіри та текстилю.', highlights: ['Шкіра та текстиль'], missingFacts: [] };
const reply = (draft = valid, finishReason = 'STOP') => ({ ok: true, json: async () => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(draft) }] } }], usageMetadata: { totalTokenCount: 120 } }) });
test('Gemini receives only product facts and key stays in the request header', async () => {
 let request;
 const result = await generateProductDescription(product, { apiKey: 'test-secret', fetchImpl: async (url, options) => { request = { url, options }; return reply(); } });
 assert.deepEqual(descriptionFacts(product), { name: 'ASICS Test', supplierDescription: 'Шкіра, текстиль' });
 assert.equal(request.options.headers['x-goog-api-key'], 'test-secret');
 assert.doesNotMatch(request.url, /test-secret/);
 assert.doesNotMatch(request.options.body, /private|2800|secret\(\)/);
 assert.deepEqual(result.draft, valid);assert.equal(result.usage.totalTokens, 120);
});
test('authentication and transport errors cannot expose provider secrets', async () => {
 await assert.rejects(generateProductDescription(product, { apiKey: 'test-secret', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'test-secret' }) }) }), { message: 'Gemini HTTP 403; check model access, key and quota' });
 await assert.rejects(generateProductDescription(product, { apiKey: 'test-secret', fetchImpl: async () => { throw new Error('test-secret'); } }), { message: 'Gemini connection failed or timed out; no automatic retry' });
});
test('rejects truncated, empty and HTML drafts and unsupported model paths', async () => {
 for (const [draft, reason] of [[valid, 'MAX_TOKENS'], [{ ...valid, description: '' }, 'STOP'], [{ ...valid, description: '<script>bad</script>' }, 'STOP']]) {
  await assert.rejects(generateProductDescription(product, { apiKey: 'x', fetchImpl: async () => reply(draft, reason) }));
 }
 await assert.rejects(generateProductDescription(product, { apiKey: 'x', model: '../evil' }), /Invalid Gemini model/);
 await assert.rejects(generateProductDescription({ name: 'Test' }, { apiKey: 'x' }), /supplier description/);
});
