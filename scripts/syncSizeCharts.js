import 'dotenv/config';
import { Api } from 'teleproto';
import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { makeTelegramClient } from '../src/services/telegram/client.js';
import { indexProducts } from '../src/services/import/article.js';
import { latestSizeCharts } from '../src/services/import/sizeChart.js';

const {values}=parseArgs({options:{apply:{type:'boolean',default:false},export:{type:'string'},channel:{type:'string',default:'black_owl_partners'}}});
let client;
const report={dryRun:!values.apply,matched:0,updated:0,missing:[],ambiguous:[]};
try {
 let snapshot;
 if(values.export) snapshot=JSON.parse(await readFile(values.export,'utf8'));
 else {
  client=await makeTelegramClient();await client.connect();
  if(!await client.checkAuthorization())throw new Error('Telegram authorization required');
  const channel=await client.getEntity(values.channel);
  const full=await client.invoke(new Api.channels.GetFullChannel({channel}));
  const chat=full.chats.find(chat=>String(chat.id)===String(full.fullChat.linkedChatId));
  if(!chat)throw new Error('Linked discussion group unavailable');
  const messages=new Map();
  for(const search of ['см','сітка','сетка','cm']) {
   for await(const m of client.iterMessages(chat,{search,waitTime:1})) {
    if(m.message)messages.set(m.id,{id:m.id,text:m.message,date:m.date});
   }
  }
  snapshot={chatId:String(chat.id),rows:[...messages.values()]};
 }
 if(!snapshot.chatId || !Array.isArray(snapshot.rows))throw new Error('Invalid chart source');
 const charts=latestSizeCharts(snapshot.rows);
 await mongoose.connect(process.env.MONGODB_URL,{serverSelectionTimeoutMS:15000,autoIndex:false});
 const collection=mongoose.connection.collection('products');
 const products=await collection.find({}).project({barcode:1,sizeChart:1}).toArray();
 const index=indexProducts(products);
 const operations=[];
 for(const [article,matches] of index) {
  if(matches.length!==1){report.ambiguous.push(article);continue;}
  const chart=charts.get(article);
  if(!chart){report.missing.push(article);continue;}
  report.matched++;
  const product=matches[0];
  if(product.sizeChart?.sourceChatId===snapshot.chatId && product.sizeChart?.sourceMessageId===chart.messageId && JSON.stringify(product.sizeChart.rows)===JSON.stringify(chart.rows))continue;
  operations.push({updateOne:{filter:{_id:product._id},update:{$set:{sizeChart:{rows:chart.rows,sourceChatId:snapshot.chatId,sourceMessageId:chart.messageId,sourceDate:new Date(chart.date*1000),syncedAt:new Date()}}}}});
 }
 report.products=products.length;report.charts=charts.size;report.pending=operations.length;
 if(values.apply && operations.length){const result=await collection.bulkWrite(operations);report.updated=result.modifiedCount;}
 console.log(JSON.stringify({products:report.products,matched:report.matched,updated:report.updated,missing:report.missing.length,ambiguous:report.ambiguous.length,dryRun:report.dryRun}));
}catch(error){report.failed=true;console.error(error.errorMessage || 'Size chart sync failed. Check Telegram authorization and MongoDB access.');process.exitCode=1;}
finally{
 if(client)await client.disconnect();await mongoose.disconnect();
 await mkdir('sync-reports',{recursive:true});await writeFile('sync-reports/size-charts.json',JSON.stringify(report,null,2));
}
