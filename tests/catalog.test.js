import test from 'node:test';
import assert from 'node:assert/strict';
import { Sneacker } from '../src/models/sneacker.js';
import { mapProductToDTO } from '../src/mappers/productMapper.js';
import { mapProductToAlgolia } from '../src/mappers/algoliaMapper.js';
import { getSneackerById, getSneackers } from '../src/controllers/sneackerControllers.js';
import { getHistory, getSitemapProducts, getMerchantProducts, chat } from '../src/controllers/catalogExtras.js';
import { requireAdmin } from '../src/middlewares/requireAdmin.js';
import { algoliaClient } from '../src/config/algolia.js';
import router from '../src/routers/sneackerRourters.js';
import { createSneackersSchema, getSneackersSchema } from '../src/validations/studentsValidation.js';
const id = '000000000000000000000001';
const secondId = '000000000000000000000002';
const product = { _id: id, name: 'Test', image: 'https://easydrop.one/test.jpg', sizes: [{size:'42',quantity:0},{size:'43',quantity:2}] };
const response = () => ({ status(code) { this.code = code; return this; }, json(body) {this.body = body;} });

test('detail DTO preserves fields used by cart and listing', () => {
  const dto = mapProductToDTO(new Sneacker(product));
  assert.equal(dto.id,id); assert.equal(dto.name,'Test'); assert.equal(dto.title,'Test');
  assert.equal(dto.image,product.image); assert.deepEqual(dto.images,[product.image]);
});
test('Algolia stock excludes sold-out facets and retains exact quantities', () => {
  const indexed = mapProductToAlgolia(product);
  assert.deepEqual(indexed.sizes,['43']);
  assert.deepEqual(mapProductToDTO(indexed).sizes, product.sizes);
});
test('missing product throws 404', async t => {
  t.mock.method(Sneacker,'findById',async()=>null);
  await assert.rejects(getSneackerById({params:{id}},response()),{status:404});
});
test('history keeps requested order and drops deleted ids', async t => {
  t.mock.method(Sneacker,'find',()=>({lean:async()=>[product,{...product,_id:secondId}]}));
  const res=response();
  await getHistory({query:{ids:`${secondId},${id},${secondId}`}},res);
  assert.deepEqual(res.body.map(p=>p.id),[secondId,id]);
  await assert.rejects(getHistory({query:{ids:'invalid'}},res),{status:400});
});
test('sitemap reads a full page and exposes continuation cursor', async t => {
  let filter;
  const docs=Array.from({length:1000},(_,i)=>({_id:(i+1).toString(16).padStart(24,'0')}));
  t.mock.method(Sneacker,'find',q=>{filter=q; return {sort:()=>({limit:()=>({select:()=>({lean:async()=>docs})})})};});
  const res=response(); await getSitemapProducts({query:{after:id}},res);
  assert.deepEqual(filter,{_id:{$gt:id}});
  assert.equal(res.body.products.length,1000); assert.equal(res.body.nextCursor,docs.at(-1)._id);
});
test('chat returns links and DTO fields from catalog search', async t => {
  t.mock.method(algoliaClient,'search',async()=>({results:[{hits:[mapProductToAlgolia(product)]}]}));
  const res=response(); await chat({body:{message:'Test'}},res);
  assert.equal(res.body.products[0].url,`/sneakers/${id}`);
  await assert.rejects(chat({body:{message:''}},res),{status:400});
});
test('catalog writes fail closed without valid administrator secret', () => {
  const previous=process.env.ADMIN_API_KEY;
  try {
    delete process.env.ADMIN_API_KEY;
    let error; const next=e=>{error=e;};
    requireAdmin({get:()=>''},null,next); assert.equal(error.status,503);
    process.env.ADMIN_API_KEY='test-secret';
    requireAdmin({get:()=> 'Bearer wrong'},null,next); assert.equal(error.status,401);
    requireAdmin({get:()=> 'Bearer test-secret'},null,next); assert.equal(error,undefined);
  } finally {
    if(previous===undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY=previous;
  }
});
test('write routes use correct verbs and authorization; history precedes id route',()=>{
  const routes=router.stack.filter(l=>l.route).map(l=>l.route);
  for(const method of ['post','patch','delete']) {
    const route=routes.find(r=>r.methods[method] && r.path.startsWith('/sneackers'));
    assert.ok(route); assert.equal(route.stack[0].handle,requireAdmin);
  }
  assert.ok(routes.findIndex(r=>r.path==='/sneackers/history') < routes.findIndex(r=>r.path==='/sneackers/:id'));
  assert.ok(createSneackersSchema.body.validate({}).error);
  assert.ok(getSneackersSchema.query.validate({minPrice:'invalid'}).error);
});

test('HTTP routes validate requests without touching external services', async t => {
  const {default:express}=await import('express');
  const {errors}=await import('celebrate');
  const app=express(); app.use(express.json()); app.use(router); app.use(errors());
  app.use((err,req,res,next)=>res.status(err.status || 500).json({message:err.message}));
  t.mock.method(Sneacker,'findById',async()=>null);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/sneackers/${id}`)).status,404);
    assert.equal((await fetch(`${base}/sneackers?minPrice=invalid`)).status,400);
    assert.equal((await fetch(`${base}/sneackers/history?ids=invalid`)).status,400);
    for(const method of ['POST','PATCH','DELETE']) {
      const url=method==='POST'?'/sneackers':`/sneackers/${id}`;
      assert.ok([401,503].includes((await fetch(base+url,{method})).status));
    }
  } finally { await new Promise(resolve=>server.close(resolve)); }
});


test('catalog endpoint returns contextual facets with the existing product contract', async t => {
  let sent;
  t.mock.method(algoliaClient,'search',async input=>{
    sent=input.requests;
    return {results:[
      {page:0,hitsPerPage:10,nbHits:1,nbPages:1,hits:[mapProductToAlgolia(product)]},
      {facets:{brand:{Nike:1}}},{facets:{model:{'Air Max 90':1}}},{facets:{sizes:{43:1}}},
    ]};
  });
  const res=response();
  await getSneackers({query:{category:'Nike'}},res);
  assert.equal(sent.length,4);
  assert.equal(res.body.filters.categoryBrand,'Nike');
  assert.deepEqual(res.body.filters.models,[{value:'Air Max 90',count:1}]);
  assert.equal(res.body.products[0].id,id);
  assert.equal(res.body.totalItems,1);
  assert.equal(getSneackersSchema.query.validate({brand:'New Balance',model:'9060'}).error,undefined);
});

test('catalog remains available from MongoDB when Algolia rejects requests', async t => {
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('reserve unavailable');});
  t.mock.method(algoliaClient,'search',async()=>{throw new Error('search unavailable');});
  t.mock.method(Sneacker,'find',()=>({select:()=>({maxTimeMS:()=>({lean:async()=>[product]})})}));
  const res=response();
  await getSneackers({query:{}},res);
  assert.equal(res.body.totalItems,1);
  assert.equal(res.body.products[0].id,id);
  assert.deepEqual(res.body.filters.sizes,[{value:'43',count:1}]);
});

test('size chart DTO exposes measurements without Telegram provenance',()=>{
 const chart={rows:[{size:'42',cm:26.5}],sourceChatId:'private',sourceMessageId:'123'};
 const dto=mapProductToDTO(new Sneacker({...product,sizeChart:chart}));
 assert.deepEqual(dto.sizeChart,[{size:'42',cm:26.5}]);
 assert.deepEqual(mapProductToDTO(product).sizeChart,[]);
});

test('seasonal products expose an actual brand and never the season as brand',()=>{
 assert.equal(mapProductToDTO({...product,name:'ASICS GEL-Kayano 20',category:'Термо'}).brand,'Asics');
 assert.equal(mapProductToDTO({...product,name:'Unknown shoe',category:'Зима'}).brand,'');
});
test('merchant export uses database cursor and preserves variant stock',async t=>{
 let filter;
 t.mock.method(Sneacker,'find',q=>{filter=q;return {sort:()=>({limit:()=>({select:()=>({maxTimeMS:()=>({lean:async()=>[product]})})})})};});
 const res=response();await getMerchantProducts({query:{after:id}},res);
 assert.deepEqual(filter,{_id:{$gt:id}});
 assert.deepEqual(res.body.products[0].sizes,product.sizes);
 assert.equal(res.body.nextCursor,null);
 await assert.rejects(getMerchantProducts({query:{after:'bad'}},res),{status:400});
});
