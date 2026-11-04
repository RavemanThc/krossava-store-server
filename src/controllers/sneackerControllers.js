import { typesenseCatalog } from '../services/catalog/typesense.js';
import { typesenseEnabled } from '../services/search/typesense.js';
import { searchWithFallback } from '../services/search/failover.js';
import { mongoCatalog } from '../services/catalog/fallback.js';
import { catalogueRequests, facetOptions } from '../services/catalog/filters.js';
import createHttpError from 'http-errors';
import { mapProductToDTO } from '../mappers/productMapper.js';
import { Sneacker } from '../models/sneacker.js';
// import normalizeSearchText from '../services/search/normalize.js';
import { algoliaClient, INDEX_NAME } from '../config/algolia.js';

export const getSneackers = async (req, res) => {
  const indexName = req.query.sortBy === 'price'
    ? (req.query.sortOrder === 'desc' ? 'sneakers_index_price_desc' : 'sneakers_index_price_asc') : INDEX_NAME;
  const { requests, fixedBrand, brand } = catalogueRequests(req.query, indexName);
  return res.json(await searchWithFallback(async () => {
    const response = await algoliaClient.search({ requests });
    const [result, brands, models, sizes] = response.results;
    return {
      page: result.page + 1, perPage: result.hitsPerPage,
      totalItems: result.nbHits, totalPages: result.nbPages,
      products: (result.hits || []).map(mapProductToDTO),
      filters: { categoryBrand: fixedBrand, brand,
        brands: facetOptions(brands?.facets?.brand),
        models: facetOptions(models?.facets?.model),
        sizes: facetOptions(sizes?.facets?.sizes),
      },
    };
  }, typesenseEnabled() ? () => typesenseCatalog(req.query) : null, async () => {
    const products = await Sneacker.find({'sizes.quantity': {$gt: 0}})
      .select('name category price image barcode sizes createdAt').maxTimeMS(10000).lean();
    return mongoCatalog(products, req.query);
  }));
};
export const getSneackerById = async (req, res) => {
  const { id } = req.params;
  const sneacker = await Sneacker.findById(id);
  if (!sneacker) {
    throw createHttpError(404, 'Sneacker not found');
  }
  res.status(200).json(mapProductToDTO(sneacker));
};
//
//
//
export const getCategories = async (req, res) => {
  const categories = (await Sneacker.distinct('category')).filter(Boolean);
  res.json(categories);
};
//
//
//
export const createNewSneacker = async (req, res) => {
  const sneacker = await Sneacker.create(req.body);

  res.status(200).json(mapProductToDTO(sneacker));
};
//
//
//
export const deleateSneackerItem = async (req, res) => {
  const { id } = req.params;
  const sneacker = await Sneacker.findOneAndDelete({ _id: id });
  if (!sneacker) {
    throw createHttpError(404, 'Sneaker not found');
  }
  res.status(200).json(mapProductToDTO(sneacker));
};
//
//
//
export const pathSneackerItem = async (req, res) => {
  const { id } = req.params;
  const sneacker = await Sneacker.findOneAndUpdate({ _id: id }, req.body, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!sneacker) {
    throw createHttpError(404, 'Sneacker not found');
  }
  res.status(200).json(mapProductToDTO(sneacker));
};
