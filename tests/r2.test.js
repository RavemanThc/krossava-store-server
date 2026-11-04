import test from 'node:test';
import assert from 'node:assert/strict';
import {createR2Storage,r2Config,imageType} from '../src/services/import/r2.js';
import {configurePhotoStorage} from '../src/services/import/photoStorage.js';
import {cleanupAssets} from '../src/services/import/catalogSync.js';
const config={bucket:'test',publicUrl:'https://img.example.com',endpoint:'https://example.invalid',credentials:{accessKeyId:'test',secretAccessKey:'test'}};
const bytes=Buffer.from([255,216,255,1]); const sha='a'.repeat(64);const key=`krossava/telegram/A0001/${sha}`;
test('R2 config requires S3 credentials and a public delivery host',()=>{
 const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_R2_BUCKET_NAME:'test',CLOUDFLARE_R2_ACCESS_KEY_ID:'test',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'test',CLOUDFLARE_R2_PUBLIC_URL:'img.example.com'};
 assert.equal(r2Config(env).publicUrl,'https://img.example.com');
 assert.throws(()=>r2Config({...env,CLOUDFLARE_R2_SECRET_ACCESS_KEY:''}));
 assert.throws(()=>r2Config({...env,CLOUDFLARE_R2_PUBLIC_URL:'https://account.r2.cloudflarestorage.com'}));
 assert.throws(()=>imageType(Buffer.from('<svg onload="bad">')));
});
test('upload writes correct MIME/cache and namespaces IDs; retries reuse existing objects',async()=>{
 const calls=[];let exists=false;
 const storage=createR2Storage(config,{send:async cmd=>{calls.push(cmd);if(cmd.constructor.name==='HeadObjectCommand'&&!exists)throw {$metadata:{httpStatusCode:404}};exists=true;return {};}});
 assert.deepEqual(await storage.uploadBytes(bytes,'A0001',sha),{url:`https://img.example.com/${key}`,publicId:`r2:${key}`});
 await storage.uploadBytes(bytes,'A0001',sha);
 const puts=calls.filter(c=>c.constructor.name==='PutObjectCommand');assert.equal(puts.length,1);assert.equal(puts[0].input.ContentType,'image/jpeg');
 assert.match(puts[0].input.CacheControl,/immutable/);
 await assert.rejects(storage.uploadBytes(bytes,'../bad',sha));
});
test('auth failures stop uploads and discard SDK request/credential details',async()=>{
 const storage=createR2Storage(config,{send:async()=>{throw {$metadata:{httpStatusCode:403},message:'private-key',request:'secret'};}});
 await assert.rejects(storage.uploadBytes(bytes,'A0001',sha),e=>e.http_code===403&&!JSON.stringify(e).includes('secret')&&!e.message.includes('private-key'));
});
test('listing traverses all pages and deletion refuses legacy or unrelated IDs',async()=>{
 const calls=[];const storage=createR2Storage(config,{send:async cmd=>{calls.push(cmd);return cmd.input.ContinuationToken?{Contents:[{Key:key}],IsTruncated:false}:{Contents:[],IsTruncated:true,NextContinuationToken:'next'};}});
 assert.deepEqual(await storage.listAssets('krossava/telegram/A0001/'),[`r2:${key}`]);
 assert.equal(calls[1].input.ContinuationToken,'next');
 await assert.rejects(storage.destroy(key));await assert.rejects(storage.destroy('r2:unrelated'));
 await storage.destroy(`r2:${key}`);assert.equal(calls.at(-1).input.Key,key);
});
test('cleanup keeps providers distinct and protects referenced R2 assets',async()=>{
 const deleted=[];let completed=false;
 await cleanupAssets({_id:'1',article:'A0001',publicIds:[key,`r2:${key}`]}, {
  isActive:async()=>false,listAssets:async()=>[],isReferenced:async id=>id.startsWith('r2:'),
  destroy:async id=>{deleted.push(id);return {result:'ok'};},complete:async()=>{completed=true;},
 });
 assert.deepEqual(deleted,[key]);assert.equal(completed,true);
});


test('R2-only cleanup never requires a working legacy account',async()=>{
 const destroyed=[];
 const storage=configurePhotoStorage({hasLegacy:true,legacy:()=>assert.fail('Cloudinary must not be called'),r2:{listAssets:async()=>[`r2:${key}`],destroy:async id=>{destroyed.push(id);return {result:'ok'};}}});
 assert.deepEqual(await storage.listAssets('krossava/telegram/A0001/',[`r2:${key}`]),[`r2:${key}`]);
 await storage.destroy(`r2:${key}`);assert.deepEqual(destroyed,[`r2:${key}`]);
});
test('legacy references are routed only to the legacy deletion API',async()=>{
 let deleted;
 const storage=configurePhotoStorage({hasLegacy:true,r2:{destroy:()=>assert.fail('must not delete R2 object')},legacy:()=>({uploader:{destroy:async id=>{deleted=id;return {result:'ok'};}}})});
 await storage.destroy(key);assert.equal(deleted,key);
 await assert.rejects(storage.destroy('unrelated'));
});


test('migration inventory avoids per-photo HEAD requests without skipping new uploads',async()=>{
 const calls=[];const storage=createR2Storage(config,{send:async command=>{calls.push(command);return {};}});
 await storage.uploadBytes(bytes,'A0001',sha,new Set([`r2:${key}`]));assert.equal(calls.length,0);
 await storage.uploadBytes(bytes,'A0001',sha,new Set());assert.equal(calls.length,1);assert.equal(calls[0].constructor.name,'PutObjectCommand');
});
