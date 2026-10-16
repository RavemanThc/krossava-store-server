import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractArticles, indexProducts } from '../src/services/import/article.js';
import { planTelegramPhotos, safePhotoPath } from '../src/services/import/telegramExport.js';
import { parseEasydrop, stockUpdateOperations } from '../src/services/import/easydrop.js';
import { mapProductToDTO } from '../src/mappers/productMapper.js';
const index=indexProducts([{_id:'1',barcode:'B4348-1210737'},{_id:'2',barcode:'A6090-123'}]);
const plan = messages => planTelegramPhotos([{id:99,root:'/export',messages}],index);

test('article matching handles Cyrillic equivalents, suffix and supplier variant',()=>{
 for(const raw of ['B4348m','В4348м','b4348-1210737','Артикул: В 4348']) assert.deepEqual(extractArticles(raw),['B4348']);
 for(const raw of ['B43481','AB4348','Б4348','4348','B4348more']) assert.deepEqual(extractArticles(raw),[]);
 assert.deepEqual(extractArticles('B4348 та A6090'),['B4348','A6090']);
});
test('comment photos inherit the SKU through nested replies, never through adjacency',()=>{
 const result=plan([
  {id:1,text:[{text:'Артикул В4348м'}]},
  {id:2,reply_to_message_id:1,photo:'photos/2.jpg',text:''},
  {id:3,reply_to_message_id:2,photo:'photos/3.jpg',text:''},
  {id:4,photo:'photos/4.jpg',text:''},
  {id:5,reply_to_message_id:1,photo:'photos/5.jpg',text:'A6090'},
 ]);
 assert.deepEqual(result.photos.map(p=>p.messageId),['2','3']);
 assert.equal(result.photos[0].article,'B4348');
 assert.deepEqual(result.issues.map(i=>i.reason),['conflicting-reply-article']);
});
test('albums with explicit group id work; ambiguous products and multiple articles are skipped',()=>{
 assert.equal(plan([{id:1,text:'B4348'},{id:2,reply_to_message_id:1,grouped_id:'a',photo:'b.jpg'},{id:3,grouped_id:'a',photo:'a.jpg'}]).photos.length,2);
 const ambiguous=indexProducts([{_id:'1',barcode:'B4348-1'},{_id:'2',barcode:'В4348-2'}]);
 assert.equal(planTelegramPhotos([{id:1,messages:[{id:1,text:'B4348'},{id:2,reply_to_message_id:1,photo:'a.jpg'}]}],ambiguous).issues[0].reason,'ambiguous-product');
 assert.equal(plan([{id:1,text:'B4348 A6090'},{id:2,reply_to_message_id:1,photo:'a.jpg'}]).issues[0].reason,'multiple-articles');
});
test('gallery keeps Easydrop first and deduplicates additional photos',()=>{
 const p=mapProductToDTO({_id:'1',image:'main.jpg',telegramPhotos:[{url:'extra.jpg'},{url:'extra.jpg'}]});
 assert.deepEqual(p.images,['main.jpg','extra.jpg']); assert.equal(p.image,'main.jpg');
});
test('photo paths cannot escape an export through traversal or symlinks',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'krossava-export-'));
 try {
  await writeFile(path.join(root,'photo.jpg'),'test');
  assert.equal(await safePhotoPath(root,'photo.jpg'),path.join(root,'photo.jpg'));
  await symlink('/etc/hosts',path.join(root,'escape.jpg'));
  await assert.rejects(safePhotoPath(root,'escape.jpg'));
  await assert.rejects(safePhotoPath(root,'../../etc/hosts'));
  await assert.rejects(safePhotoPath(root,'/etc/hosts'));
 } finally {await rm(root,{recursive:true,force:true});}
});
const feed = quantity => `<shop><catalog><category id="1">Nike</category></catalog><items><item id="9" group_id="7"><categoryId>1</categoryId><name>Nike Test 42</name><priceuah>1900</priceuah><image>https://easydrop.one/test.jpg</image><barcode>B4348-9</barcode><param name="Розмір">42</param><quantity_in_stock>${quantity}</quantity_in_stock></item></items></shop>`;
test('Easydrop updates stock without overwriting imported gallery',async()=>{
 const products=await parseEasydrop(feed(0));
 assert.equal(products[0].sizes[0].quantity,0);
 assert.equal(products[0].name,'Nike Test');
 const update=stockUpdateOperations(products)[0].updateOne.update.$set;
 assert.equal(update.price,1900); assert.equal(update.telegramPhotos,undefined);
 await assert.rejects(parseEasydrop(feed('invalid')));
 await assert.rejects(parseEasydrop('<shop/>'));
});

test('only first ten comment photos are selected, root photo is excluded',()=>{
 const root={id:1,text:'B4348',photo:'main.jpg'};
 const replies=Array.from({length:12},(_,i)=>({id:i+2,reply_to_message_id:1,photo:`${i}.jpg`}));
 const result=plan([root,...replies.reverse()]);
 assert.equal(result.photos.length,10);
 assert.deepEqual(result.photos.map(p=>Number(p.messageId)),[2,3,4,5,6,7,8,9,10,11]);
 assert.ok(result.photos.every(p=>p.file!=='main.jpg' && p.threadId==='1'));
});
test('latest discussion replaces older thread and channel photos are ignored',()=>{
 const result=plan([{id:1,text:'B4348'},{id:2,reply_to_message_id:1,photo:'old.jpg'},
 {id:10,text:'B4348'},{id:11,reply_to_message_id:10,photo:'new.jpg'}]);
 assert.deepEqual(result.photos.map(p=>p.file),['new.jpg']);
 assert.equal(planTelegramPhotos([{id:1,type:'public_channel',messages:[{id:1,text:'B4348'},{id:2,reply_to_message_id:1,photo:'channel.jpg'}]}],index).photos.length,0);
});

test('supplier MA and MB prefixes stay distinct from A and B',()=>{
 assert.deepEqual(extractArticles('МВ4821-1340836'), ['MB4821']);
 assert.deepEqual(extractArticles('МА4829'), ['MA4829']);
 const products=indexProducts([{_id:'1',barcode:'MB4821-1'},{_id:'2',barcode:'B4821-2'}]);
 assert.equal(products.get('MB4821')[0]._id,'1');
 assert.equal(products.get('B4821')[0]._id,'2');
 assert.deepEqual(extractArticles('AMB4821'),[]);
});
