import {categoryBrand} from './classification.js';
const facet=(field,value)=>`${field}:${JSON.stringify(value)}`;
export function catalogueRequests(query,indexName) {
  const fixedBrand=categoryBrand(query.category);
  const brand=fixedBrand || query.brand || '';
  const base=['inStock:true'];
  if(query.category && !fixedBrand)base.push(facet('category',query.category));
  if(query.minPrice!==undefined || query.maxPrice!==undefined)base.push(`price:${query.minPrice ?? 0} TO ${query.maxPrice ?? 999999}`);
  const filters=(includeBrand,includeModel,includeSize)=>[
    ...base,...(includeBrand && brand?[facet('brand',brand)]:[]),
    ...(includeModel && query.model?[facet('model',query.model)]:[]),
    ...(includeSize && query.size?[facet('sizes',query.size)]:[]),
  ].join(' AND ');
  const common={indexName,query:String(query.search || '')};
  return {fixedBrand,brand,requests:[
    {...common,page:Math.max(0,Number(query.page || 1)-1),hitsPerPage:Math.min(50,Number(query.perPage || 10)),filters:filters(true,true,true)},
    {...common,hitsPerPage:0,facets:['brand'],maxValuesPerFacet:100,filters:filters(Boolean(fixedBrand),false,true)},
    {...common,hitsPerPage:0,facets:['model'],maxValuesPerFacet:1000,filters:filters(true,false,true)},
    {...common,hitsPerPage:0,facets:['sizes'],maxValuesPerFacet:100,filters:filters(true,true,false)},
  ]};
}
export const facetOptions = values => Object.entries(values || {}).filter(([value,count])=>value && count>0)
  .map(([value,count])=>({value,count})).sort((a,b)=>a.value.localeCompare(b.value,'uk',{numeric:true}));
