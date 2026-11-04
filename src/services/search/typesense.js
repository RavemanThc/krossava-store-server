import { mapProductToAlgolia } from '../../mappers/algoliaMapper.js';

export const collectionName = () => process.env.TYPESENSE_COLLECTION || 'sneakers_index';
export const typesenseEnabled = () => Boolean(process.env.TYPESENSE_HOST && process.env.TYPESENSE_SEARCH_KEY);
export const typesenseWritesEnabled = () => Boolean(process.env.TYPESENSE_HOST && process.env.TYPESENSE_WRITE_KEY);
export function collectionSchema(name = collectionName()) {
  return { name, fields: [
    { name: 'name', type: 'string' }, { name: 'barcode', type: 'string', optional: true },
    ...['category', 'brand', 'model'].map(name => ({ name, type: 'string', facet: true })),
    { name: 'sizes', type: 'string[]', facet: true },
    { name: 'inStock', type: 'bool', facet: true }, { name: 'price', type: 'float' },
    { name: 'createdAtTimestamp', type: 'int64' },
  ], default_sorting_field: 'createdAtTimestamp' };
}
export function mapProductToTypesense(product) {
  const record = mapProductToAlgolia(product);
  return { ...record, id: record.objectID, name: String(record.name || ''),
    category: String(record.category || ''), barcode: String(record.barcode || ''),
    sizes: [...new Set(record.sizes.map(String))],
    createdAtTimestamp: Math.floor((new Date(product.createdAt || 0).getTime() || 0) / 1000),
  };
}
export async function typesenseRequest(path, { method = 'GET', body, write = false, raw = false } = {}) {
  const key = write ? process.env.TYPESENSE_WRITE_KEY : process.env.TYPESENSE_SEARCH_KEY;
  const host = process.env.TYPESENSE_HOST;
  if (!host || !key) throw new Error('Typesense is not configured');
  const url = new URL(host.startsWith('https://') ? host : `https://${host}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid Typesense HTTPS host');
  }
  const response = await fetch(new URL(path, url), {
    method, headers: { 'X-TYPESENSE-API-KEY': key, 'Content-Type': raw ? 'text/plain' : 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(write ? 30000 : 2500),
  });
  if (!response.ok) {
    const error = new Error(`Typesense request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return raw ? response.text() : response.json();
}
export async function upsertTypesenseProducts(products, request = typesenseRequest) {
  if (!typesenseWritesEnabled()) return;
  for (let offset = 0; offset < products.length; offset += 100) {
    const batch = products.slice(offset, offset + 100).map(mapProductToTypesense);
    const response = await request(`/collections/${encodeURIComponent(collectionName())}/documents/import?action=upsert`, {
      method: 'POST', write: true, raw: true, body: batch.map(p => JSON.stringify(p)).join('\n'),
    });
    const rows = response.trim().split('\n').map(line => JSON.parse(line));
    if (rows.length !== batch.length || rows.some(row => row.success !== true)) throw new Error('Typesense import contains failed documents');
  }
}
export async function deleteTypesenseProducts(ids, request = typesenseRequest) {
  if (!typesenseWritesEnabled()) return;
  for (const id of ids) {
    try {
      await request(`/collections/${encodeURIComponent(collectionName())}/documents/${encodeURIComponent(id)}`, { method: 'DELETE', write: true });
    } catch (error) { if (error.status !== 404) throw error; }
  }
}
