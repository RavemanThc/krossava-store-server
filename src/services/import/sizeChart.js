import { extractArticles } from './article.js';

// Parse only explicit supplier measurements, never infer a brand's sizing.
export function parseSizeChart(text) {
  const normalized = String(text || '').normalize('NFKC');
  const labelled = normalized.match(/(?:артикул|арт\.)[^\S\n]*[:№]?[^\S\n]*([^\n]+)/iu);
  const articles = extractArticles(labelled ? labelled[1] : normalized);
  if (articles.length !== 1) return null;
  const rows = [];
  for (const match of normalized.matchAll(/(?<![\d.,])(\d{2}(?:[.,]\d)?)\s*(?:EU\s*)?[=:\-–—]\s*(\d{2}(?:[.,]\d{1,2})?)\s*(?:см|cm)(?!\p{L})/giu)) {
    const size = match[1].replace(',', '.');
    const cm = Number(match[2].replace(',', '.'));
    if (Number(size) < 15 || Number(size) > 55 || cm < 10 || cm > 40) return null;
    const existing = rows.find(row => row.size === size);
    if (existing && existing.cm !== cm) return null;
    if (!existing) rows.push({ size, cm });
  }
  if (rows.length < 2) return null;
  rows.sort((a,b) => Number(a.size) - Number(b.size));
  return { article: articles[0], rows };
}

export function latestSizeCharts(messages) {
  const charts = new Map();
  for (const message of messages) {
    const parsed = parseSizeChart(message.text);
    if (!parsed) continue;
    const previous = charts.get(parsed.article);
    if (!previous || Number(message.id) > Number(previous.messageId)) {
      charts.set(parsed.article, { rows: parsed.rows, messageId: String(message.id), date: message.date });
    }
  }
  return charts;
}
