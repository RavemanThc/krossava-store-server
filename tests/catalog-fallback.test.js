import test from 'node:test';
import assert from 'node:assert/strict';
import {mongoCatalog} from '../src/services/catalog/fallback.js';
const products=[
 {_id:'1',name:'New Balance 9060 Black',category:'Термо',price:200,sizes:[{size:'42',quantity:1}]},
 {_id:'2',name:'Adidas Superstar White',category:'Термо',price:100,sizes:[{size:'43',quantity:1}]},
 {_id:'3',name:'New Balance 530 White',category:'Осінь',price:150,sizes:[{size:'42',quantity:1}]},
 {_id:'4',name:'New Balance 9060 Grey',category:'Термо',price:50,sizes:[{size:'42',quantity:0}]},
];
test('fallback preserves seasonal brand/model filters and available facets',()=>{
 const result=mongoCatalog(products,{category:'Термо',brand:'New Balance',model:'9060'});
 assert.deepEqual(result.products.map(p=>p.id),['1']);
 assert.deepEqual(result.filters.brands.map(p=>p.value),['Adidas','New Balance']);
 assert.deepEqual(result.filters.sizes,[{value:'42',count:1}]);
});
test('fallback supports fixed brands, literal search, price, sorting and pagination',()=>{
 const result=mongoCatalog(products,{category:'New Balance',brand:'Adidas',perPage:1,page:2,sortBy:'price',sortOrder:'asc'});
 assert.equal(result.totalItems,2);assert.equal(result.totalPages,2);
 assert.equal(result.products[0].id,'1');
 assert.equal(result.filters.categoryBrand,'New Balance');
 assert.equal(mongoCatalog(products,{search:'.*'}).totalItems,0);
 assert.equal(mongoCatalog(products,{search:'superstar',maxPrice:120}).products[0].id,'2');
});
