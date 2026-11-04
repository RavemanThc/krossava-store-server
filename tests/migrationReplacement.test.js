import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replacementHash } from '../src/services/import/migrationReplacement.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const oldHash = hash('original');
const entry = {productId:'product1',sourceChatId:'123',sourceMessageId:7,
  sourceThreadId:5,article:'B4348',oldSha256:oldHash,sha256:hash('current')};
const input = {productId:'product1',photo:{sourceChatId:'123',sourceMessageId:7,
  sourceThreadId:5,sha256:oldHash},article:'B4348',oldHash,bytes:Buffer.from('current')};

test('changed bytes require an explicit approved replacement', () => {
  assert.throws(() => replacementHash(input), /hash mismatch/);
  assert.equal(replacementHash({...input,replacements:[entry]}), hash('current'));
  assert.equal(replacementHash({...input,bytes:Buffer.from('original')}), oldHash);
});

test('replacement cannot cross product, message, article or thread boundaries', () => {
  for (const change of [{productId:'other'},{sourceChatId:'999'},{sourceMessageId:8},
    {sourceThreadId:6},{article:'A1234'},{oldSha256:hash('other')},{sha256:'invalid'}]) {
    assert.throws(() => replacementHash({...input,replacements:[{...entry,...change}]}));
  }
  assert.throws(() => replacementHash({...input,replacements:[entry,entry]}), /Duplicate/);
  assert.throws(() => replacementHash({...input,bytes:Buffer.from('unexpected'),replacements:[entry]}), /hash mismatch/);
});
