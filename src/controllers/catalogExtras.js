import createHttpError from 'http-errors';
import { Sneacker } from '../models/sneacker.js';
import { mapProductToDTO } from '../mappers/productMapper.js';
import { algoliaClient, INDEX_NAME } from '../config/algolia.js';

export const getHistory = async (req, res) => {
  if (typeof req.query.ids !== 'string') throw createHttpError(400, 'ids must be a comma-separated list');
  const ids = [...new Set(req.query.ids.split(',').filter(Boolean))];
  if (ids.length > 20 || ids.some(id => !/^[a-f0-9]{24}$/i.test(id))) {
    throw createHttpError(400, 'Invalid product ids');
  }
  const products = await Sneacker.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map(product => [String(product._id), product]));
  res.json(ids.map(id => byId.get(id.toLowerCase())).filter(Boolean).map(mapProductToDTO));
};

// Read MongoDB directly: Algolia limits the number of searchable pages.
export const getSitemapProducts = async (req, res) => {
  const after = req.query.after;
  if (after !== undefined && (typeof after !== 'string' || !/^[a-f0-9]{24}$/i.test(after))) {
    throw createHttpError(400, 'Invalid cursor');
  }
  const products = await Sneacker.find(after ? { _id: { $gt: after } } : {})
    .sort({ _id: 1 }).limit(1000).select('_id name updatedAt').lean();
  res.json({
    products: products.map(p => ({ id: String(p._id), name: p.name, updatedAt: p.updatedAt })),
    nextCursor: products.length === 1000 ? String(products.at(-1)._id) : null,
  });
};

export const chat = async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 500) {
    throw createHttpError(400, 'Введіть назву або артикул товару (до 500 символів).');
  }
  const result = await algoliaClient.search({ requests: [{
    indexName: INDEX_NAME, query: message.trim(), hitsPerPage: 5,
  }] });
  const products = (result.results[0].hits || []).map(mapProductToDTO).map(p => ({
    id: p.id, name: p.name, price: p.price, image: p.image,
    sizeText: p.sizes.map(s => s.size).join(', '), url: `/sneakers/${p.id}`,
  }));
  res.json({ message: products.length
    ? 'Ось товари за вашим запитом. Відкрийте картку, щоб перевірити наявність розміру.'
    : 'Товарів не знайдено. Спробуйте ввести назву моделі, бренд або артикул.', products });
};
