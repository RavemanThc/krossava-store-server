// Empty successful results are authoritative; only failures advance the chain.
export async function searchWithFallback(primary, secondary, lastResort, warn = console.warn) {
  try { return await primary(); } catch { warn('Algolia unavailable; trying reserve search'); }
  if (secondary) {
    try { return await secondary(); } catch { warn('Typesense unavailable; using MongoDB fallback'); }
  }
  return lastResort();
}
