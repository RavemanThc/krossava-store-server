import { categoryBrand } from './classification.js';
import { facetOptions } from './filters.js';
import { mapProductToDTO } from '../../mappers/productMapper.js';
import { collectionName, typesenseRequest } from '../search/typesense.js';

const exact = (field, value) => {
  const text = String(value);
  // Ambiguous delimiters use the MongoDB fallback instead of changing the filter.
  if (/[`\\]/u.test(text)) throw new Error('Unsupported Typesense filter delimiter');
  return `${field}:=\`${text}\``;
};
const number = value => {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('Invalid numeric filter');
  return result;
};
export function typesenseSearches(query) {
  const fixedBrand = categoryBrand(query.category);
  const brand = fixedBrand || query.brand || '';
  const page = Math.max(1, Math.floor(number(query.page || 1)));
  const perPage = Math.max(1, Math.min(50, Math.floor(number(query.perPage || 10))));
  const base = ['inStock:=true'];
  if (query.category && !fixedBrand) base.push(exact('category', query.category));
  if (query.minPrice !== undefined) base.push(`price:>=${number(query.minPrice)}`);
  if (query.maxPrice !== undefined) base.push(`price:<=${number(query.maxPrice)}`);
  const filters = (useBrand, useModel, useSize) => [...base,
    ...(useBrand && brand ? [exact('brand', brand)] : []),
    ...(useModel && query.model ? [exact('model', query.model)] : []),
    ...(useSize && query.size ? [exact('sizes', query.size)] : []),
  ].join(' && ');
  const common = { collection: collectionName(), q: String(query.search || '').trim() || '*',
    query_by: 'name,barcode', num_typos: '2,0', highlight_fields: 'none',
  };
  return { fixedBrand, brand, page, perPage, searches: [
    { ...common, page, per_page: perPage, filter_by: filters(true, true, true),
      sort_by: query.sortBy === 'price' ? `price:${query.sortOrder === 'desc' ? 'desc' : 'asc'},_text_match:desc`
        : '_text_match:desc,createdAtTimestamp:desc' },
    ...[['brand', [Boolean(fixedBrand), false, true], 100], ['model', [true, false, true], 1000], ['sizes', [true, true, false], 100]]
      .map(([field, flags, max]) => ({ ...common, per_page: 0, facet_by: field, max_facet_values: max, filter_by: filters(...flags) })),
  ] };
}
export async function typesenseCatalog(query, request = typesenseRequest) {
  const { fixedBrand, brand, page, perPage, searches } = typesenseSearches(query);
  const response = await request('/multi_search', { method: 'POST', body: { searches } });
  if (!Array.isArray(response.results) || response.results.length !== 4 ||
      response.results.some(result => result.error || !Number.isFinite(result.found))) throw new Error('Incomplete Typesense search');
  const [result, brands, models, sizes] = response.results;
  if (!Array.isArray(result.hits)) throw new Error('Invalid Typesense hits');
  const facets = (result, field) => facetOptions(Object.fromEntries(
    (result.facet_counts?.find(facet => facet.field_name === field)?.counts || []).map(row => [row.value, row.count]),
  ));
  return { page, perPage, totalItems: result.found, totalPages: Math.ceil(result.found / perPage),
    products: result.hits.map(hit => mapProductToDTO(hit.document)),
    filters: { categoryBrand: fixedBrand, brand, brands: facets(brands, 'brand'), models: facets(models, 'model'), sizes: facets(sizes, 'sizes') },
  };
}
