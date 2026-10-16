import 'dotenv/config';
import { Api } from 'teleproto';
import { parseArgs } from 'node:util';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { Sneacker } from '../src/models/sneacker.js';
import { extractArticles, indexProducts } from '../src/services/import/article.js';
import { makeTelegramClient } from '../src/services/telegram/client.js';
const {values} = parseArgs({options:{ limit:{type:'string'}, 'missing-only':{type:'boolean',default:false}, output:{type:'string',default:'.telegram/comments-export'}, channel:{type:'string',default:'black_owl_partners'} }});
const output=path.resolve(values.output);
const chats=new Map();const issues=[];const seen=new Set();let client;let scanned=0;
try {
 client=await makeTelegramClient();await client.connect();
 if(!await client.checkAuthorization())throw new Error('Run npm run telegram:login first.');
 await mongoose.connect(process.env.MONGODB_URL,{serverSelectionTimeoutMS:15000});
 const index=indexProducts(await Sneacker.find(values['missing-only'] ? {'telegramPhotos.0':{$exists:false},'sizes.quantity':{$gt:0}} : {}).select('barcode').lean());
 const channel=await client.getEntity(values.channel);
 try {
  const previous=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
  if(previous.sourceChannel===values.channel) for(const chat of previous.chats.list){
   chats.set(String(chat.id),chat);
   for(const m of chat.messages){if(m.photo)continue;const codes=extractArticles(m.text||'');if(codes.length===1)seen.add(codes[0]);}
  }
 }catch(error){if(error.code!=='ENOENT')throw error;}

 await mkdir(path.join(output,'photos'),{recursive:true,mode:0o700});
 for await(const post of client.iterMessages(channel,{waitTime:1})){
  if(values['missing-only'] && seen.size >= index.size) break;
  scanned++;
  const codes=extractArticles(post.message||'');if(codes.length!==1)continue;
  const article=codes[0];if(seen.has(article)||(index.get(article)||[]).length!==1||!post.replies?.comments)continue;
  try{
   const discussion=await client.invoke(new Api.messages.GetDiscussionMessage({peer:channel,msgId:post.id}));
   const root=discussion.messages.find(m=>m.peerId?.channelId && String(m.peerId.channelId)!==String(channel.id));
   if(!root)throw new Error('Discussion root not found.');
   const chatId=String(root.peerId.channelId);const selected=[];
   // GetReplies for this channel post only, oldest first. Never download post.media.
   for await(const comment of client.iterMessages(channel,{replyTo:post.id,reverse:true,waitTime:1})){
    if(String(comment.peerId?.channelId)!==chatId||comment.id===root.id||!comment.media?.photo)continue;
    selected.push(comment);if(selected.length===10)break;
   }
   if(!selected.length)continue;
   const messages=[{id:root.id,text:post.message,date_unixtime:post.date}];
   const downloaded = new Array(selected.length);
   let nextPhoto = 0;
   const downloads = await Promise.allSettled(Array.from({length:3}, async () => {
    while(nextPhoto < selected.length){
    const position = nextPhoto++;
    const comment = selected[position];
    const relative=`photos/${chatId}-${comment.id}.jpg`;
    await client.downloadMedia(comment,{outputFile:path.join(output,relative)});
    downloaded[position]={id:comment.id,text:comment.message||'',date_unixtime:comment.date,reply_to_message_id:root.id,photo:relative};
    }
   }));
   const failedDownload=downloads.find(result=>result.status==='rejected');
   if(failedDownload)throw failedDownload.reason;
   messages.push(...downloaded);
   if(!chats.has(chatId))chats.set(chatId,{id:chatId,type:'private_supergroup',messages:[]});
   chats.get(chatId).messages.push(...messages);seen.add(article);
   await writeFile(path.join(output,'result.json.tmp'),JSON.stringify({sourceChannel:values.channel,chats:{list:[...chats.values()]}},null,2));
   await rename(path.join(output,'result.json.tmp'),path.join(output,'result.json'));
   console.log(JSON.stringify({article,photos:selected.length,products:seen.size}));
  }catch(error){
   issues.push({postId:post.id,article,reason:error.errorMessage||'Discussion unavailable or download failed'});
   if(error.seconds||error.errorMessage?.includes('AUTH'))throw error;
  }
  if(values.limit && seen.size >= Number(values.limit)) break;
 }
} catch(error) {console.error(error.message?.startsWith('Set TELEGRAM')?error.message:(error.errorMessage||'Telegram collection stopped. Check login and access to the discussion group.'));process.exitCode=1;}
finally {
 await mkdir(output,{recursive:true,mode:0o700});
 if(issues.length)process.exitCode=1;
 await writeFile(path.join(output,'collection-report.json'),JSON.stringify({scanned,products:seen.size,issues},null,2));
 if(client)await client.disconnect();await mongoose.disconnect();
}
