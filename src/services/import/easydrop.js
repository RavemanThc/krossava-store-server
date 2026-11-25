import { parseStringPromise } from 'xml2js';

export async function parseEasydrop(xml) {
  const result = await parseStringPromise(xml);
  const categories = new Map((result.shop?.catalog?.[0]?.category || []).map(c => [c.$.id, c._]));
  const items = result.shop?.items?.[0]?.item;
  if (!Array.isArray(items) || !items.length) throw new Error('Easydrop returned an empty or invalid feed.');
  const grouped = new Map();
  for (const item of items) {
    const groupId = item.$?.group_id;
    const size = item.param?.find(p => p.$?.name === 'Розмір')?._;
    const price = Number(item.priceuah?.[0]);
    const quantity = Number(item.quantity_in_stock?.[0]);
    if (!groupId || !item.name?.[0] || !size || !item.$?.id || !item.quantity_in_stock?.length || !item.priceuah?.length
      || !Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 0 || !item.image?.[0]) {
      throw new Error('Invalid Easydrop row. No stock updates were applied.');
    }
    if (!grouped.has(groupId)) grouped.set(groupId, {
      groupId, name: item.name[0].replace(/\s\d+$/, ''),
      category: categories.get(item.categoryId?.[0]) || '',
      price, image: item.image[0], description: item.description?.[0] || '',
      barcode: item.barcode?.[0] || '', sizes: [],
    });
    const product = grouped.get(groupId);
    if (product.sizes.some(s => s.size === size)) throw new Error('Duplicate size within Easydrop product.');
    product.sizes.push({ size, quantity, itemId: item.$.id });
  }
  return [...grouped.values()];
}

export function stockUpdateOperations(products, syncedAt = new Date()) {
  return products.map(product => ({ updateOne: {
    filter: { groupId: product.groupId },
    // Evaluate against the current document, not a snapshot taken before generation.
    // Retain copy while changed supplier facts wait for a fresh generation.
    update: [{ $set: {
      ...Object.fromEntries(Object.entries(product).map(([key, value]) => [key, { $literal: value }])),
      supplierDescription: { $literal: product.description },
      description: { $cond: [
        { $and: [
          { $eq: ['$name', { $literal: product.name }] },
          { $eq: [{ $type: '$aiDescription.text' }, 'string'] },
          { $ne: ['$aiDescription.text', ''] },
        ] },
        '$aiDescription.text', { $literal: product.description },
      ] },
      lastSyncAt: { $literal: syncedAt },
      createdAt: { $ifNull: ['$createdAt', { $literal: syncedAt }] },
    } }],
    upsert: true,
  } }));
}
