import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { descriptionFacts } from './productDescription.js';

const officialDomains = ['asics.com', 'nike.com', 'adidas.com', 'adidas.ua', 'newbalance.com', 'reebok.com', 'salomon.com', 'puma.com', 'hoka.com', 'merrell.com', 'columbia.com', 'ugg.com', 'vans.com', 'converse.com', 'thenorthface.com', 'underarmour.com', 'premiata.it'];
const retailDomains = ['prom.ua', 'rozetka.com.ua', 'shafa.ua', 'bigl.ua', 'vseklass.com.ua', 'cro.com.ua', 'leshuze.com.ua', 'kross.com.ua'];
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/gore[\s-]*tex/g, 'gtx').replace(/\bgray\b/g, 'grey').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
export function researchKey(name) {
  // Keep colours and all modifications until shared construction is explicitly confirmed.
  return createHash('sha256').update(`serper-name-v1:${normalize(name)}`).digest('hex');
}
export function matchesName(name, title) {
  const expected = normalize(name), actual = normalize(title);
  if (!expected || !(` ${actual} `).includes(` ${expected} `)) return false;
  const extra = actual.replace(expected, '');
  // Never let an unrequested seasonal/technology suffix silently change the model.
  return !/(?:^|[^\p{L}\p{N}])(?:gtx|winter|fur|fleece|термо|хутро|мех|black|white|grey|red|blue|green|orange|pink|beige|brown)(?=$|[^\p{L}\p{N}])/iu.test(extra);
}
export function sourceType(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.endsWith('.')) return null;
    const inList = list => list.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return inList(officialDomains) ? 'manufacturer_reference' : inList(retailDomains) ? 'retailer_claim' : null;
  } catch { return null; }
}
const failure = (status, message) => Object.assign(new Error(message), { status, provider: 'serper' });

export async function searchSerper(name, { apiKey = process.env.SERPERAPI || process.env.SERPER_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw failure(401, 'Missing Serper API key');
  const response = await fetchImpl('https://google.serper.dev/search', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: `"${String(name).replace(/["\r\n]/g, ' ').slice(0, 250)}"`, gl: 'ua', hl: 'en', num: 10 }),
  }).catch(() => { throw failure(503, 'Serper connection failed'); });
  if (!response.ok) throw failure(response.status, `Serper HTTP ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw failure(502, 'Invalid Serper response'); }
  if (!data || typeof data !== 'object' || (!Array.isArray(data.organic) && !data.searchParameters)) throw failure(502, 'Invalid Serper result');
  return { credits: data.credits ?? 1, results: (data.organic || []).slice(0, 10).map(row => ({
    title: String(row.title || '').slice(0, 500), url: String(row.link || '').slice(0, 2000), snippet: String(row.snippet || '').slice(0, 1000),
  })) };
}

export async function readSourcePage(raw, { fetchImpl = fetch } = {}) {
  let url = raw;
  // No arbitrary hosts, redirects to unknown domains, private URLs or API keys on source requests.
  for (let redirects = 0; redirects < 3; redirects++) {
    if (!sourceType(url)) throw new Error('Unapproved source host');
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'text/html', 'User-Agent': 'KrossavaProductResearch/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Invalid source redirect');
      url = new URL(location, url).href; continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel(); throw new Error('Source unavailable');
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 1500000) throw new Error('Source too large');
      chunks.push(chunk);
    }
    const $ = load(Buffer.concat(chunks).toString('utf8'));
    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || $('title').text();
    $('script,style,nav,header,footer,form').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const start = text.indexOf(title);
    return { url, title: title.slice(0, 500), text: text.slice(Math.max(0, start), Math.max(0, start) + 18000) };
  }
  throw new Error('Too many source redirects');
}

// Whitelisted basic materials only. Search results alone are never accepted as facts.
export function corroboratedFacts(supplierDescription, pages) {
  const rules = [
    ['upper_textile', 'текстиль', /текстил[ьиюя]?/iu],
    ['upper_leather', 'шкіра', /(?:шкір[аи]|кож[аи])/iu],
    ['upper_suede', 'замша', /замш[аиі]?/iu],
  ];
  return rules.flatMap(([id, value, pattern]) => {
    if (!pattern.test(supplierDescription)) return [];
    const ambiguous = text => /(?:штуч|искусствен|еко.?шкір|эко.?кож|не\s+(?:шкір|кож))/iu.test(text);
    if (id === 'upper_leather' && ambiguous(supplierDescription)) return [];
    const sources = pages.filter(page => pattern.test(page.materialEvidence || '') &&
      !(id === 'upper_leather' && ambiguous(page.materialEvidence || ''))).map(page => page.url);
    return sources.length ? [{ id, attribute: 'supplier_material', value, sourceUrls: sources,
      verification: 'supplier_claim_corroborated_on_matching_page' }] : [];
  });
}

export async function getSerperResearch(product, db, { search = searchSerper, readPage = readSourcePage } = {}) {
  const cache = db.collection('catalog_model_research');
  const key = researchKey(product.name);
  let record = await cache.findOne({ _id: key });
  const cacheHit = Boolean(record?.status === 'ready' && (!record.retryAfter || record.retryAfter > new Date()));
  let creditsUsed = 0;
  if (!cacheHit) {
    if (record?.status === 'ready') record = null;
    const control = db.collection('catalog_description_control');
    const day = new Date().toISOString().slice(0, 10);
    const limit = Number(process.env.SERPER_DAILY_LIMIT || 1000);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw failure(400, 'Invalid Serper limit');
    // Called under the shared description-worker lease.
    if (!record?.results) {
      if ((await control.findOne({ _id: `serper:${day}` }))?.requests >= limit) throw failure(429, 'Serper local daily limit');
      await control.updateOne({ _id: `serper:${day}` }, { $inc: { requests: 1 } }, { upsert: true });
      const result = await search(product.name);
      creditsUsed = result.credits;
      record = { name: product.name, status: 'searched', results: result.results, credits: result.credits, searchedAt: new Date() };
      // Persist the paid search before reading pages, so a crash cannot repeat it.
      await cache.updateOne({ _id: key }, { $set: record }, { upsert: true });
    }
    const candidates = record.results.filter(row => sourceType(row.url) && matchesName(product.name, row.title))
      .sort((a, b) => Number(sourceType(b.url) === 'manufacturer_reference') - Number(sourceType(a.url) === 'manufacturer_reference'));
    const pages = [];
    for (const row of candidates.slice(0, 3)) {
      try {
        const page = await readPage(row.url);
        if (!matchesName(product.name, page.title)) continue;
        // Save a bounded factual excerpt, not complete shop descriptions or boilerplate.
        const evidence = page.text.match(/(?:Матеріал(?:\s+верху)?|Материал(?:\s+верха)?)\s*[:：]\s*([^▪📦\n]{1,250})/iu)?.[0] || '';
        pages.push({ url: page.url, title: page.title, type: sourceType(page.url), materialEvidence: evidence,
          checkedAt: new Date(), contentHash: createHash('sha256').update(page.text).digest('hex') });
      } catch { /* An unavailable page is not evidence. Keep the successful search cached. */ }
    }
    record = { ...record, status: 'ready', pages, match: pages.length ? 'name_matched' : 'unconfirmed',
      checkedAt: new Date(), retryAfter: pages.length ? null : new Date(Date.now() + 7 * 86400000) };
    await cache.updateOne({ _id: key }, { $set: record });
  }
  const facts = descriptionFacts(product);
  const approvedFacts = corroboratedFacts(facts.supplierDescription, record.pages || []);
  return { cacheKey: key, cacheHit, match: record.match, sources: (record.pages || []).map(({ url, title, type }) => ({ url, title, type })),
    approvedFacts, rejectedUnverifiedProperties: true, credits: creditsUsed,
    note: 'Name match does not establish authenticity or identical construction. Only supplier corroboration is passed to the writer.' };
}
