import { algoliaClient, INDEX_NAME } from '../config/algolia.js';
import { mapProductToDTO } from '../mappers/productMapper.js';

export const searchProductsForAI = async (req, res) => {
  const {
    query = '',
    size,
    gender,
    category,
    minPrice,
    maxPrice,
    limit = 6,
    sortOrder,
  } = req.query;

  const filterArray = [];

  if (category) {
    filterArray.push(`category:"${category}"`);
  }

  if (size) {
    filterArray.push(`sizes:"${size}"`);
  } else if (gender === 'women') {
    filterArray.push(
      '(sizes:"36" OR sizes:"37" OR sizes:"38" OR sizes:"39" OR sizes:"40")',
    );
  }

  if (minPrice || maxPrice) {
    const min = Number(minPrice) || 0;
    const max = Number(maxPrice) || 999999;

    filterArray.push(`price:${min} TO ${max}`);
  }

  const searchOptions = {
    indexName: INDEX_NAME,
    query: String(query),
    page: 0,
    hitsPerPage: Math.min(Math.max(Number(limit) || 6, 1), 10),
  };

  if (filterArray.length) {
    searchOptions.filters = filterArray.join(' AND ');
  }

  if (sortOrder === 'asc') {
    searchOptions.indexName = 'sneakers_index_price_asc';
  }

  if (sortOrder === 'desc') {
    searchOptions.indexName = 'sneakers_index_price_desc';
  }

  const searchResponse = await algoliaClient.search({
    requests: [searchOptions],
  });

  const result = searchResponse.results[0];

  const products = result.hits?.map(mapProductToDTO) ?? [];

  res.status(200).json({
    total: result.nbHits,
    count: products.length,
    products,
  });
};
