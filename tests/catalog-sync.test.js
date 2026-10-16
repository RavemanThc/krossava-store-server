import test from 'node:test';
import assert from 'node:assert/strict';
import {planCatalogSync,cleanupAssets,cleanupEntry} from '../src/services/import/catalogSync.js';
const product=(id,quantity=1)=>({_id:id,groupId:id,barcode:`A${id.padStart(4,'0')}`,sizes:[{size:'40',quantity},{size:'41',quantity:0}]});
test('daily plan updates available sizes, adds products and removes fully sold-out or missing products',()=>{
 const existing=['1','2','3','4'].map(id=>product(id));
 const plan=planCatalogSync([product('1'),product('2',0),product('4'),product('5')],existing);
 assert.deepEqual(plan.active.map(p=>p.groupId),['1','4','5']);
 assert.deepEqual(plan.removed.map(p=>p.groupId),['2','3']);assert.equal(plan.newProducts,1);
});
test('partial and suspicious empty-stock feeds cannot delete the catalogue',()=>{
 const existing=['1','2','3','4'].map(id=>product(id));
 assert.throws(()=>planCatalogSync([],existing));
 assert.throws(()=>planCatalogSync([product('1')],existing));
 assert.throws(()=>planCatalogSync(existing.map(p=>product(p.groupId,0)),existing));
 assert.throws(()=>planCatalogSync([product('1'),product('1')],existing));
});
const id='krossava/telegram/A0001/'+'a'.repeat(64);
const extra='krossava/telegram/A0001/'+'b'.repeat(64);
const entry={_id:'1',article:'A0001',publicIds:[id]};
function deps(overrides={}){return {isActive:async()=>false,listAssets:async()=>[id,extra],isReferenced:async()=>false,destroy:async()=>({result:'ok'}),complete:async()=>{},...overrides};}
test('cleanup deletes known and orphaned photos, but protects shared assets',async()=>{
 const deleted=[];let completed=false;
 const n=await cleanupAssets(entry,deps({isReferenced:async x=>x===extra,destroy:async x=>{deleted.push(x);return {result:'ok'};},complete:async()=>{completed=true;}}));
 assert.equal(n,1);assert.deepEqual(deleted,[id]);assert.equal(completed,true);
});
test('cleanup survives partial failures and retries not-found assets',async()=>{
 let completed=false;
 await assert.rejects(cleanupAssets(entry,deps({destroy:async x=>{if(x===extra)throw new Error('network');return {result:'ok'};},complete:async()=>{completed=true;}})));
 assert.equal(completed,false);
 await cleanupAssets(entry,deps({destroy:async()=>({result:'not found'}),complete:async()=>{completed=true;}}));assert.equal(completed,true);
});
test('returned stock protects images and unexpected asset paths are rejected',async()=>{
 await cleanupAssets(entry,deps({isActive:async()=>true,destroy:async()=>assert.fail('must not delete')}));
 await assert.rejects(cleanupAssets({...entry,publicIds:['unrelated']},deps()));
 assert.deepEqual(cleanupEntry({...product('1'),telegramPhotos:[{publicId:id},{publicId:id}]}).publicIds,[id]);
});
