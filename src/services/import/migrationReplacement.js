import { createHash } from 'node:crypto';

// A changed Telegram image requires an explicitly approved, reference-bound manifest.
export function replacementHash({ productId, photo, article, oldHash, bytes, replacements = [] }) {
  const matches = replacements.filter(entry => entry.productId === productId &&
    String(entry.sourceChatId) === String(photo.sourceChatId) &&
    String(entry.sourceMessageId) === String(photo.sourceMessageId));
  if (matches.length > 1) throw new Error('Duplicate replacement reference');
  const entry = matches[0];
  if (entry && (String(entry.sourceThreadId) !== String(photo.sourceThreadId) ||
    entry.article !== article || entry.oldSha256 !== oldHash ||
    entry.oldSha256 !== photo.sha256 || !/^[a-f0-9]{64}$/.test(entry.sha256))) {
    throw new Error('Replacement does not match saved product reference');
  }
  const expected = entry ? entry.sha256 : oldHash;
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error('Source hash mismatch');
  }
  return expected;
}
