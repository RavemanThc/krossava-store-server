import test from 'node:test';
import assert from 'node:assert/strict';
import { typesenseSearches, typesenseCatalog } from '../src/services/catalog/typesense.js';
import { mapProductToTypesense, upsertTypesenseProducts, deleteTypesenseProducts } from '../src/services/search/typesense.js';
import { searchWithFallback } from '../src/services/search/failover.js';
import { syncSearchProducts } from '../src/services/search/sync.js';
import { getSneackers } from '../src/controllers/sneackerControllers.js';
import { algoliaClient } from '../src/config/algolia.js';
import { Sneacker } from '../src/models/sneacker.js';
const product={_id:'000000000000000000000001',name:'Nike Air Max 90',category:'Термо',price:1200,sizes:[{size:'42',quantity:2},{size:'43',quantity:0}]};
const failed=async()=>{throw new Error('unavailable');};
const quiet=()=>{};
function configure(t) {
 const old={...process.env};
 Object.assign(process.env,{TYPESENSE_HOST:'example.test',TYPESENSE_SEARCH_KEY:'test',TYPESENSE_WRITE_KEY:'test'});
 t.after(()=>{for(const key of ['TYPESENSE_HOST','TYPESENSE_SEARCH_KEY','TYPESENSE_WRITE_KEY']) {if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
}
const results=()=>({results:[{found:1,hits:[{document:mapProductToTypesense(product)}]},
 {found:1,facet_counts:[{field_name:'brand',counts:[{value:'Nike',count:1}]}]},
 {found:1,facet_counts:[{field_name:'model',counts:[{value:'Air Max 90',count:1}]}]},
 {found:1,facet_counts:[{field_name:'sizes',counts:[{value:'42',count:1}]}]}]});
test('fallback returns primary including empty results and advances only on failure',async()=>{
 assert.deepEqual(await searchWithFallback(async()=>[],failed,failed,quiet),[]);
 assert.equal(await searchWithFallback(failed,async()=>2,failed,quiet),2);
 assert.equal(await searchWithFallback(failed,failed,async()=>3,quiet),3);
 assert.equal(await searchWithFallback(failed,null,async()=>3,quiet),3);
 await assert.rejects(searchWithFallback(failed,failed,failed,quiet));
});
test('Typesense preserves stock quantities, IDs and available sizes',()=>{
 const mapped=mapProductToTypesense(product);
 assert.equal(mapped.id,product._id);assert.equal(mapped.objectID,product._id);
 assert.deepEqual(mapped.sizes,['42']);assert.deepEqual(mapped.stock,product.sizes);
});
test('facets retain parent filters and permit changing the selected facet',()=>{
 const {searches:s}=typesenseSearches({category:'Термо',brand:'Nike',model:'Air Max 90',size:'42',minPrice:1000,maxPrice:2000,page:2,sortBy:'price'});
 assert.match(s[0].filter_by,/category:=`Термо`/);assert.equal(s[0].page,2);assert.equal(s[0].sort_by,'price:asc,_text_match:desc');
 assert.match(s[0].filter_by,/price:>=1000 && price:<=2000/);
 assert.doesNotMatch(s[1].filter_by,/brand:|model:/);assert.match(s[1].filter_by,/sizes:=`42`/);
 assert.match(s[2].filter_by,/brand:=`Nike`/);assert.doesNotMatch(s[2].filter_by,/model:/);
 assert.doesNotMatch(s[3].filter_by,/sizes:/);
 const fixed=typesenseSearches({category:'Nike',brand:'Adidas'});
 assert.equal(fixed.brand,'Nike');for(const row of fixed.searches){assert.doesNotMatch(row.filter_by,/category:|Adidas/);assert.match(row.filter_by,/brand:=`Nike`/);}
 assert.throws(()=>typesenseSearches({brand:'Nike` || inStock:false'}));
 assert.throws(()=>typesenseSearches({minPrice:'0 || inStock:false'}));
});
test('Typesense result is compatible with catalog DTO and rejects partial multi-search errors',async()=>{
 const result=await typesenseCatalog({},async()=>results());
 assert.equal(result.products[0].id,product._id);assert.deepEqual(result.products[0].sizes,product.sizes);
 assert.deepEqual(result.filters.sizes,[{value:'42',count:1}]);
 await assert.rejects(typesenseCatalog({},async()=>({results:[{found:1},{error:'unavailable'}]})));
});
test('catalog controller uses Typesense on Algolia failure without reading MongoDB',async t=>{
 configure(t);t.mock.method(algoliaClient,'search',failed);
 t.mock.method(Sneacker,'find',()=>assert.fail('MongoDB should not be used'));
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(new URL(url).pathname,'/multi_search');assert.equal(options.headers['X-TYPESENSE-API-KEY'],'test');
  assert.equal(JSON.parse(options.body).searches.length,4);
  return {ok:true,json:async()=>results()};
 });
 let body;await getSneackers({query:{category:'Nike'}},{json:value=>{body=value;}});
 assert.equal(body.products[0].id,product._id);assert.equal(body.filters.categoryBrand,'Nike');
});
test('imports reject per-document failures even with a successful HTTP response',async t=>{
 configure(t);
 await assert.rejects(upsertTypesenseProducts([product],async()=>'{"success":false,"error":"bad field"}'));
 let batches=0;
 await upsertTypesenseProducts(Array.from({length:201},()=>product),async(path,options)=>{
  batches++;return options.body.split('\n').map(()=>'{"success":true}').join('\n');
 });assert.equal(batches,3);
});
test('deletions tolerate missing documents but surface permission failures',async t=>{
 configure(t);await deleteTypesenseProducts(['abc'],async()=>{throw Object.assign(new Error(),{status:404});});
 await assert.rejects(deleteTypesenseProducts(['abc'],async()=>{throw Object.assign(new Error(),{status:403});}));
});
test('replication attempts the reserve even if Algolia fails and reports incomplete replication',async()=>{
 let reserve=false;
 await assert.rejects(syncSearchProducts([product],[],[failed,async()=>{reserve=true;}]),/Algolia/);
 assert.equal(reserve,true);
});
