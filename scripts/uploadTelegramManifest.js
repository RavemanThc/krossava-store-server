throw new Error('Public post photo import is disabled. Use import:photos with discussion comments only.');
import 'dotenv/config';
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import mongoose from 'mongoose';
import {Sneacker} from '../src/models/sneacker.js';
import {indexProducts} from '../src/services/import/article.js';
import {configureCloudinary,uploadPhoto} from '../src/services/import/cloudinary.js';
import {parsePublicPage} from '../src/services/import/telegramPublic.js';
const {values}=parseArgs({options:{manifest:{type:'string'},report:{type:'string',default:'telegram-upload-report.json'}}});
if(!values.manifest) throw new Error('Provide --manifest from import:telegram-public.');
const report={uploaded:0,alreadyLinked:0,processed:0,total:0,issues:[],complete:false};
let tmp;let stopped=false;
function clean(error){let message=String(error.error?.message||error.message||'Upload failed');for(const [key,value] of Object.entries(process.env))if(value&&/KEY|SECRET|URL|CLOUDINARY/.test(key))message=message.replaceAll(value,`[${key}]`);return message;}
async function download(url){
 const target=new URL(url);
 if(target.protocol!=='https:'||!/^cdn\d+\.telesco\.pe$/.test(target.hostname))throw new Error('Unexpected photo host.');
 const response=await fetch(target,{signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Telegram photo unavailable');
 const parts=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>20*1024*1024)throw new Error('Photo too large');parts.push(chunk);}
 return Buffer.concat(parts);
}
try{
 const manifest=JSON.parse(await readFile(values.manifest,'utf8'));
 if(!/^[A-Za-z0-9_]+$/.test(manifest.channel)||!Array.isArray(manifest.matched))throw new Error('Invalid manifest.');
 await configureCloudinary().api.ping();
 await mongoose.connect(process.env.MONGODB_URL,{serverSelectionTimeoutMS:15000});
 const products=await Sneacker.find({}).select('barcode telegramPhotos').lean();
 const index=indexProducts(products);const groups=new Map();
 for(const post of manifest.matched){
  const candidates=index.get(post.article)||[];
  if(candidates.length!==1||String(candidates[0]._id)!==post.productId){report.issues.push({article:post.article,postId:post.postId,reason:'product-match-changed'});continue;}
  if(!groups.has(post.productId))groups.set(post.productId,{product:candidates[0],posts:[]});
  groups.get(post.productId).posts.push(post);report.total+=post.photos.length;
 }
 tmp=await mkdtemp(path.join(os.tmpdir(),'krossava-upload-'));
 const queue=[...groups.values()];let cursor=0;
 async function worker(){
  while(cursor<queue.length&&!stopped){
   const {product,posts}=queue[cursor++];
   const hashes=new Set((product.telegramPhotos||[]).map(p=>p.sha256));
   const sources=new Set((product.telegramPhotos||[]).filter(p=>p.sourceChatId===manifest.channel).map(p=>p.sourceMessageId));
   for(const post of posts){
    for(let i=0;i<post.photos.length&&!stopped;i++){
     // A single-photo post already persisted can be skipped without downloading.
     if(post.photos.length===1&&sources.has(String(post.postId))){report.alreadyLinked++;report.processed++;continue;}
     let done=false;let lastError;
     for(let attempt=0;attempt<3&&!done&&!stopped;attempt++){
      let file;
      try{
       let data;
       try{data=await download(post.photos[i]);}
       catch{
        const response=await fetch(`https://t.me/s/${manifest.channel}/${post.postId}`,{signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error('Telegram post refresh failed');
        const current=parsePublicPage(await response.text(),manifest.channel).posts.find(p=>p.id===post.postId);
        if(!current||current.articles.length!==1||current.articles[0]!==post.article||!current.photos[i])throw new Error('Telegram post unavailable or article changed');
        post.photos=current.photos;data=await download(post.photos[i]);
       }
       const hash=createHash('sha256').update(data).digest('hex');
       if(hashes.has(hash)){report.alreadyLinked++;done=true;break;}
       file=path.join(tmp,`${post.productId}-${hash}.jpg`);await writeFile(file,data);
       const asset=await uploadPhoto(file,post.article,hash);
       const result=await Sneacker.updateOne({_id:post.productId,'telegramPhotos.sha256':{$ne:hash}},{$push:{telegramPhotos:{...asset,sha256:hash,sourceChatId:manifest.channel,sourceMessageId:String(post.postId)}}});
       if(result.modifiedCount)report.uploaded++;else report.alreadyLinked++;
       hashes.add(hash);done=true;
      }catch(error){lastError=error;if([401,403,420,429].includes(error.http_code||error.error?.http_code))stopped=true;else await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
      finally{if(file)await rm(file,{force:true});}
     }
     if(!done)report.issues.push({article:post.article,postId:post.postId,reason:clean(lastError||new Error('Stopped'))});
     report.processed++;
     if(report.processed%50===0)console.log(JSON.stringify({processed:report.processed,total:report.total,uploaded:report.uploaded,duplicates:report.alreadyLinked,errors:report.issues.length}));
    }
   }
  }
 }
 await Promise.all(Array.from({length:6},worker));
 report.complete=!stopped&&report.processed===report.total;
 if(stopped||report.issues.length)process.exitCode=1;
}catch(error){report.error=clean(error);process.exitCode=1;}
finally{
 await mongoose.disconnect();if(tmp)await rm(tmp,{recursive:true,force:true});
 await writeFile(values.report,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
