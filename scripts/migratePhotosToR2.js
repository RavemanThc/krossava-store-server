import 'dotenv/config';
import { parseArgs } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { replacementHash } from '../src/services/import/migrationReplacement.js';
import { readTelegramExport, safePhotoPath } from '../src/services/import/telegramExport.js';
import { Sneacker } from '../src/models/sneacker.js';
import { createR2Storage, assetKeyPattern, verifyPublicImage } from '../src/services/import/r2.js';

const {values}=parseArgs({options:{apply:{type:'boolean',default:false},limit:{type:'string'},'switch-links':{type:'boolean',default:false},export:{type:'string',multiple:true},concurrency:{type:'string'},'retry-report':{type:'string'},replacements:{type:'string'}}});
const limit=values.limit === undefined ? Infinity : Number(values.limit);
if(values['switch-links'] && !values.apply) throw new Error('Use --apply with --switch-links');
if(!(limit>0 && (limit===Infinity || Number.isSafeInteger(limit)))) throw new Error('Invalid limit');
const concurrency=Number(values.concurrency || 8);
if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>48) throw new Error('Concurrency must be between 1 and 48');
const report={dryRun:!values.apply,products:0,photos:0,migrated:0,failed:0,conflicts:0,issues:[],changes:[]};
let stopping=false;
process.once('SIGINT',()=>{stopping=true;process.exitCode=1;});
async function readPhoto(url) {
  const target=new URL(url);
  if(target.protocol!=='https:' || target.hostname!=='res.cloudinary.com' || target.username || target.password) throw new Error('Unexpected source URL');
  const response=await fetch(target,{signal:AbortSignal.timeout(60000),redirect:'error'});
  if(!response.ok) {const error=new Error('Source image unavailable');error.http_code=response.status;throw error;}
  const chunks=[]; let length=0;
  for await(const chunk of response.body) {
    length+=chunk.length;
    if(length>25*1024*1024) throw new Error('Source image too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
try {
  const replacements=values.replacements ? JSON.parse(await readFile(values.replacements,'utf8')) : [];
  if(!Array.isArray(replacements)) throw new Error('Invalid replacement manifest');
  const local=new Map();
  for(const input of values.export || []) for(const chat of await readTelegramExport(input)) {
    for(const message of chat.messages) if(message.photo) local.set(`${chat.id}:${message.id}`,{root:chat.root,file:message.photo});
  }
  const storage=createR2Storage(); await storage.check();
  await mongoose.connect(process.env.MONGODB_URL,{serverSelectionTimeoutMS:15000,autoIndex:false,autoCreate:false});
  const products=await Sneacker.find({'telegramPhotos.0':{$exists:true}}).select('telegramPhotos').lean();
  const retryIds=values['retry-report'] ? new Set(JSON.parse(await readFile(values['retry-report'],'utf8')).issues.map(issue=>issue.productId)) : null;
  const pending=products.filter(p=>(!retryIds || retryIds.has(String(p._id))) && p.telegramPhotos.some(photo=>photo.publicId && !photo.publicId.startsWith('r2:'))).slice(0,limit);
  report.products=pending.length;
  report.photos=pending.reduce((n,p)=>n+p.telegramPhotos.filter(photo=>!photo.publicId?.startsWith('r2:')).length,0);
  if(values.apply) {
    const existingIds=new Set(await storage.listAssets('krossava/telegram/'));
    console.log(JSON.stringify({existingR2Objects:existingIds.size,products:pending.length}));
    let next=0;
    await Promise.all(Array.from({length:concurrency},async()=>{
      while(!stopping && next<pending.length) {
        const product=pending[next++]; const gallery=[]; const changes=[]; let stage='source';
        try {
          for(const photo of product.telegramPhotos) {
            if(photo.publicId?.startsWith('r2:')) {gallery.push(photo);continue;}
            if(!assetKeyPattern.test(photo.publicId || '')) throw new Error('Invalid legacy asset');
            const [, , article, oldHash]=photo.publicId.split('/');
            stage='source';
            const source=local.get(`${photo.sourceChatId}:${photo.sourceMessageId}`);
            const bytes=source ? await readFile(await safePhotoPath(source.root,source.file)) : await readPhoto(photo.url);
            const sha256=replacementHash({productId:String(product._id),photo,article,oldHash,bytes,replacements});
            stage='upload'; const asset=await storage.uploadBytes(bytes,article,sha256,existingIds);
            // Do not replace working links until public delivery is confirmed.
            stage='public-delivery'; await verifyPublicImage(asset.url);
            gallery.push({...photo,...asset,sha256});
            changes.push({from:photo.publicId,to:asset.publicId});
          }
          // Preserve any gallery changed concurrently by an importer.
          stage='database';
          const result=values['switch-links'] ? await Sneacker.updateOne({_id:product._id,telegramPhotos:product.telegramPhotos},{$set:{telegramPhotos:gallery}}) : {matchedCount:1};
          if(result.matchedCount) {report.migrated+=changes.length;report.changes.push({productId:String(product._id),assets:changes,linksSwitched:values['switch-links']});}
          else report.conflicts++;
        }catch(error) {report.failed++;const issue={productId:String(product._id),stage,status:error.http_code || null,operation:error.operation,reason:error.reason};report.issues.push(issue);console.log(JSON.stringify({issue}));}
        if((report.changes.length+report.failed+report.conflicts)%20===0) console.log(JSON.stringify({completed:report.changes.length,failed:report.failed,conflicts:report.conflicts,photos:report.migrated}));
      }
    }));
  }
}catch {report.error='R2 migration failed; check configuration and service access';process.exitCode=1;}
finally {
  report.interrupted=stopping;
  await mongoose.disconnect(); await mkdir('sync-reports',{recursive:true});
  const file=`sync-reports/r2-migration-${Date.now()}.json`;
  await writeFile(file,JSON.stringify(report,null,2));
  if(report.failed || report.conflicts) process.exitCode=1;
  console.log(JSON.stringify({...report,changes:undefined,report:file}));
}
