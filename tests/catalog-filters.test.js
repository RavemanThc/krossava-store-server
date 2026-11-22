import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProduct, categoryBrand} from '../src/services/catalog/classification.js';
import {catalogueRequests, facetOptions} from '../src/services/catalog/filters.js';
import {mapProductToAlgolia} from '../src/mappers/algoliaMapper.js';

test('models group colour and seasonal variants across supplier categories', () => {
  for (const name of ['New Balance 9060 Black White','New Balance 9060 GTX Grey']) {
    assert.deepEqual(classifyProduct({name,category:'Термо'}),{brand:'New Balance',model:'9060'});
  }
  for (const name of ['Adidas Superstar White','Adidas Originals Superstar Black']) {
    assert.deepEqual(classifyProduct({name,category:'Уцінка'}),{brand:'Adidas',model:'Superstar'});
  }
  assert.equal(classifyProduct({name:'Adidas Campus 00s Black'}).model,'Campus 00s');
  assert.equal(classifyProduct({name:'New Balance ML574 Grey'}).model,'574');
  assert.equal(classifyProduct({name:'DC x Marvel Deadpool Court Graffik Black White'}).model,'Court Graffik');
  assert.deepEqual(classifyProduct({name:'Calvin Klein GTX Grey'}),{brand:'Calvin Klein',model:''});
  assert.deepEqual(classifyProduct({name:'Unidentified shoes'}),{brand:'',model:''});
  assert.equal(categoryBrand(' nike '),'Nike');
  assert.equal(categoryBrand('❄️Зима❄️'),'');
});
test('brand category fixes brand and does not restrict supplier category', () => {
  const {fixedBrand,brand,requests}=catalogueRequests({category:'Nike',brand:'Adidas',model:'Air Max 90',size:'42',page:3},'catalog');
  assert.equal(fixedBrand,'Nike'); assert.equal(brand,'Nike');
  assert.equal(requests[0].page,2);
  assert.equal(requests[0].filters,'inStock:true AND brand:"Nike" AND model:"Air Max 90" AND sizes:"42"');
  for(const request of requests) assert.doesNotMatch(request.filters,/category:|Adidas/);
});
test('seasonal facets keep parent constraints but allow changing their own selection', () => {
  const {fixedBrand,requests}=catalogueRequests({category:'Термо',brand:'Adidas',model:'Superstar',size:'42',search:'Black'},'catalog');
  assert.equal(fixedBrand,'');
  assert.match(requests[0].filters,/category:"Термо" AND brand:"Adidas" AND model:"Superstar" AND sizes:"42"/);
  assert.equal(requests[1].filters,'inStock:true AND category:"Термо" AND sizes:"42"');
  assert.equal(requests[2].filters,'inStock:true AND category:"Термо" AND brand:"Adidas" AND sizes:"42"');
  assert.equal(requests[3].filters,'inStock:true AND category:"Термо" AND brand:"Adidas" AND model:"Superstar"');
  assert.ok(requests.every(r=>r.query==='Black'));
});
test('filter values are escaped and facet options exclude empty/unavailable values', () => {
  const {requests}=catalogueRequests({brand:'A" OR brand:"B'},'catalog');
  assert.equal(requests[0].filters,'inStock:true AND brand:"A\\" OR brand:\\"B"');
  assert.deepEqual(facetOptions({'':3,'42':4,'40':2,'41':0}),[{value:'40',count:2},{value:'42',count:4}]);
});
test('indexed availability contains only purchasable sizes', () => {
  const product={_id:'abc',name:'Nike Air Max 90 Black',sizes:[{size:'42',quantity:2},{size:'43',quantity:0}]};
  assert.equal(mapProductToAlgolia(product).inStock,true);
  assert.deepEqual(mapProductToAlgolia(product).sizes,['42']);
  assert.equal(mapProductToAlgolia({...product,sizes:[]}).inStock,false);
});

test('recognizes Premiata and Air Jordan in seasonal categories',()=>{
 assert.equal(classifyProduct({name:'Premiata Moerun Fur M Navy',category:'Зима'}).brand,'Premiata');
 assert.deepEqual(classifyProduct({name:'Air Jordan 4 Retro Fur M Black Cat',category:'Зима'}),{brand:'Nike',model:'Air Jordan 4'});
});
