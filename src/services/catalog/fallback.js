import { classifyProduct, categoryBrand } from './classification.js';
import { facetOptions } from './filters.js';
import { mapProductToDTO } from '../../mappers/productMapper.js';

// Emergency read path when the external search service is unavailable.
export function mongoCatalog(products, query) {
  const fixedBrand = categoryBrand(query.category);
  const brand = fixedBrand || query.brand || '';
  const words = String(query.search || '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rows = products.map(product => ({ product, ...classifyProduct(product),
    sizes: [...new Set((product.sizes || []).filter(s => s.quantity > 0).map(s => s.size))],
  })).filter(row => row.sizes.length &&
    (!query.category || fixedBrand || row.product.category === query.category) &&
    (query.minPrice === undefined || row.product.price >= Number(query.minPrice)) &&
    (query.maxPrice === undefined || row.product.price <= Number(query.maxPrice)) &&
    words.every(word => `${row.product.name} ${row.product.barcode || ''}`.toLocaleLowerCase().includes(word)));
  const matches = (row, useBrand, useModel, useSize) =>
    (!useBrand || !brand || row.brand === brand) &&
    (!useModel || !query.model || row.model === query.model) &&
    (!useSize || !query.size || row.sizes.includes(query.size));
  const facets = (field, flags) => {
    const counts = Object.create(null);
    for (const row of rows.filter(row => matches(row, ...flags))) {
      for (const value of field === 'sizes' ? row.sizes : [row[field]]) {
        if (value) counts[value] = (counts[value] || 0) + 1;
      }
    }
    return facetOptions(counts);
  };
  const selected = rows.filter(row => matches(row, true, true, true));
  selected.sort((a,b) => (query.sortBy === 'price'
    ? (a.product.price - b.product.price) * (query.sortOrder === 'desc' ? -1 : 1)
    : new Date(b.product.createdAt || 0) - new Date(a.product.createdAt || 0)) ||
    String(a.product._id).localeCompare(String(b.product._id)));
  const page = Math.max(1, Number(query.page || 1));
  const perPage = Math.min(50, Number(query.perPage || 10));
  return {page, perPage, totalItems:selected.length, totalPages:Math.ceil(selected.length/perPage),
    products:selected.slice((page-1)*perPage,page*perPage).map(row => mapProductToDTO(row.product)),
    filters:{categoryBrand:fixedBrand,brand,brands:facets('brand',[Boolean(fixedBrand),false,true]),
      models:facets('model',[true,false,true]),sizes:facets('sizes',[true,true,false])}};
}
