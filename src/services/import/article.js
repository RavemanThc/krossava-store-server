// Only visual equivalents are safe. Do not transliterate Б -> B or Н -> N.
const equivalents = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y', І: 'I' };
const normalizeLetter = letter => equivalents[letter] || (/^[A-Z]$/.test(letter) ? letter : null);
export function extractArticles(text) {
  const normalized = String(text || '').normalize('NFKC').toUpperCase();
  const result = new Set();
  for (const match of normalized.matchAll(/(?<![\p{L}\p{N}])([A-ZА-ЯІЇЄ]{1,2})\s*(\d{4})(?!\d)(?:[A-ZА-ЯІЇЄ])?(?![\p{L}\p{N}])/gu)) {
    const letters = [...match[1]].map(normalizeLetter);
    if (letters.some(letter => !letter)) continue;
    const prefix = letters.join('');
    if (prefix.length === 1 || ['MA', 'MB'].includes(prefix)) result.add(`${prefix}${match[2]}`);
  }
  return [...result];
}
export function productArticle(barcode) {
  const codes = extractArticles(barcode);
  return codes.length === 1 ? codes[0] : null;
}
export function indexProducts(products) {
  const index = new Map();
  for (const product of products) {
    const code = productArticle(product.barcode);
    if (!code) continue;
    index.set(code, [...(index.get(code) || []), product]);
  }
  return index;
}
