import 'dotenv/config';
import { Api } from 'teleproto';
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import mongoose from 'mongoose';
import { Sneacker } from '../src/models/sneacker.js';
import { makeTelegramClient } from '../src/services/telegram/client.js';
const {values}=parseArgs({options:{report:{type:'string'},output:{type:'string',default:'.telegram/r2-recovery'}}});
if(!values.report) throw new Error('Provide --report with the migration failure report');
const output=path.resolve(values.output);let client;
const summary={recovered:0,reused:0,issues:[]};
const messages=new Map();let chatId;
async function checkpoint(){
 const data={sourceChannel:'black_owl_partners',chats:{list:[{id:chatId,type:'private_supergroup',messages:[...messages.values()]}]}};
 await writeFile(path.join(output,'result.json.tmp'),JSON.stringify(data));
 await rename(path.join(output,'result.json.tmp'),path.join(output,'result.json'));
 await writeFile(path.join(output,'recovery-report.json'),JSON.stringify(summary,null,2));
}
try {
 const report=JSON.parse(await readFile(values.report,'utf8'));
 const ids=[...new Set(report.issues.map(issue=>issue.productId))];
 if(ids.some(id=>!/^[a-f0-9]{24}$/i.test(id)))throw new Error('Invalid product IDs');
 await mongoose.connect(process.env.MONGODB_URL,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:15000});
 const products=await Sneacker.find({_id:{$in:ids}}).select('telegramPhotos').lean();
 client=await makeTelegramClient();await client.connect();
 if(!await client.checkAuthorization()) throw new Error('Telegram authorization required');
 const channel=await client.getEntity('black_owl_partners');
 const full=await client.invoke(new Api.channels.GetFullChannel({channel}));
 chatId=String(full.fullChat.linkedChatId);
 const discussion=full.chats.find(chat=>String(chat.id)===chatId);
 if(!discussion) throw new Error('Supplier discussion unavailable');
 await mkdir(path.join(output,'photos'),{recursive:true,mode:0o700});
 const selected=new Map();
 for(const product of products)for(const photo of product.telegramPhotos){
  if(photo.publicId?.startsWith('r2:'))continue;
  if(photo.sourceChatId!==chatId || !/^\d+$/.test(photo.sourceMessageId) || !/^[a-f0-9]{64}$/.test(photo.sha256 || '')){
   summary.issues.push({productId:String(product._id),reason:'invalid-source-reference'});continue;
  }
  const existing=selected.get(photo.sourceMessageId);
  if(existing && existing.sha256!==photo.sha256)throw new Error('Conflicting source hashes');
  selected.set(photo.sourceMessageId,photo);
 }
 const requested=[...selected.values()];
 for(let offset=0;offset<requested.length;offset+=20){
  const batch=requested.slice(offset,offset+20);
  const found=await client.getMessages(discussion,{ids:batch.map(p=>Number(p.sourceMessageId))});
  let next=0;
  await Promise.all(Array.from({length:3},async()=>{
   while(next<batch.length){
    const photo=batch[next++];const relative=`photos/${chatId}-${photo.sourceMessageId}.jpg`;
    const file=path.join(output,relative);
    try {
     let bytes;try{bytes=await readFile(file);}catch{}
     if(bytes && createHash('sha256').update(bytes).digest('hex')===photo.sha256)summary.reused++;
     else {
      const message=found.find(message=>String(message.id)===photo.sourceMessageId);
      if(!message?.media?.photo || String(message.peerId?.channelId)!==chatId) throw new Error('Original message/photo unavailable');
      bytes=await client.downloadMedia(message,{});
      if(!bytes?.length || createHash('sha256').update(bytes).digest('hex')!==photo.sha256) throw new Error('Original photo hash mismatch');
      await writeFile(file,bytes);summary.recovered++;
     }
     messages.set(photo.sourceMessageId,{id:Number(photo.sourceMessageId),photo:relative});
    }catch(error){
     if(error.seconds || error.errorMessage?.includes('AUTH')) throw new Error('Telegram rate limit or authorization interruption');
     summary.issues.push({messageId:photo.sourceMessageId,reason:error.message==='Original photo hash mismatch'?'hash-mismatch':error.message==='Original message/photo unavailable'?'source-photo-unavailable':'download-failed'});
    }
   }
  }));
  await checkpoint();
  console.log(JSON.stringify({processed:Math.min(offset+20,requested.length),total:requested.length,recovered:summary.recovered,reused:summary.reused,failed:summary.issues.length}));
 }
}catch{summary.failed=true;console.error('Recovery stopped. Check Telegram access and the recovery report.');process.exitCode=1;}
finally{
 if(summary.issues.length)process.exitCode=1;
 if(chatId)await checkpoint();
 if(client)await client.disconnect();await mongoose.disconnect();
 console.log(JSON.stringify({recovered:summary.recovered,reused:summary.reused,issues:summary.issues.length,failed:summary.failed || false}));
}
