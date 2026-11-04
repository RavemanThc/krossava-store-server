import { productArticle } from './article.js';

export const hasStock = product => product.sizes.some(size => size.quantity > 0);

export function planCatalogSync(incoming, existing) {
  if (!incoming.length || new Set(incoming.map(p => p.groupId)).size !== incoming.length) throw new Error('Invalid or duplicate feed groups.');
  const managed = existing.filter(p => p.groupId);
  if (managed.length && incoming.length < managed.length / 2) throw new Error('Feed is unexpectedly small.');
  const active = incoming.filter(hasStock);
  const ids = new Set(active.map(p => p.groupId));
  const removed = managed.filter(p => !ids.has(p.groupId));
  if (managed.length && removed.length > managed.length / 2) throw new Error('Unexpected mass removal.');
  return { active, removed, newProducts: active.filter(p => !managed.some(old => old.groupId === p.groupId)).length };
}

export function cleanupEntry(product) {
  return { _id: product.groupId, article: productArticle(product.barcode),
    publicIds: [...new Set((product.telegramPhotos || []).map(p => p.publicId).filter(Boolean))] };
}

// The durable queue is removed only after every asset has been deleted successfully.
export async function cleanupAssets(entry, { isActive, listAssets, isReferenced, destroy, complete }) {
  if (await isActive(entry)) { await complete(entry._id); return 0; }
  const ids = new Set(entry.publicIds);
  if (entry.article) for (const id of await listAssets(`krossava/telegram/${entry.article}/`, entry.publicIds)) ids.add(id);
  let deleted = 0;
  for (const id of ids) {
    if (!/^(?:r2:)?krossava\/telegram\/(?:[A-Z]|M[AB])\d{4}\/[a-f0-9]{64}$/.test(id)) throw new Error('Unexpected gallery asset path.');
    if (await isReferenced(id)) continue;
    const result = await destroy(id);
    if (!['ok', 'not found'].includes(result.result)) throw new Error('Gallery deletion failed.');
    deleted++;
  }
  await complete(entry._id);
  return deleted;
}
