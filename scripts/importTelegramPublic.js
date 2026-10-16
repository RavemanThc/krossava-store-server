throw new Error('Public post photo import is disabled. Use import:photos with discussion comments only.');
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { Sneacker } from '../src/models/sneacker.js';
import { indexProducts } from '../src/services/import/article.js';
import { parsePublicPage } from '../src/services/import/telegramPublic.js';
import { configureCloudinary, uploadPhoto } from '../src/services/import/cloudinary.js';
const {values} = parseArgs({options: {
  channel: {type:'string',default:'black_owl_partners'},
  report: {type:'string',default:'telegram-public-report.json'},
  apply: {type:'boolean',default:false},
}});
if (!/^[A-Za-z0-9_]+$/.test(values.channel)) throw new Error('Invalid channel.');
const report = {channel:values.channel,dryRun:!values.apply,pages:0,posts:0,matched:[],issues:[],uploaded:0,alreadyLinked:0,complete:false};
let temporary;
try {
  // Fail before expensive work when the upload account is misconfigured.
  if (values.apply) await configureCloudinary().api.ping();
  await mongoose.connect(process.env.MONGODB_URL,{serverSelectionTimeoutMS:15000});
  const products=await Sneacker.find({}).select('barcode name telegramPhotos').lean();
  const index=indexProducts(products);
  const hashes=new Set(products.flatMap(p=>(p.telegramPhotos||[]).map(photo=>`${p._id}:${photo.sha256}`)));
  temporary=await mkdtemp(path.join(os.tmpdir(),'krossava-public-'));
  let before; const seenPosts=new Set();
  for(let page=0;page<2000;page++) {
    const response=await fetch(`https://t.me/s/${values.channel}${before?`?before=${before}`:''}`,{signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
    const parsed=parsePublicPage(await response.text(),values.channel);
    if(!parsed.posts.length) throw new Error('Telegram page contained no posts; scan incomplete.');
    report.pages++;
    for(const post of parsed.posts) {
      if(seenPosts.has(post.id)) continue; seenPosts.add(post.id); report.posts++;
      if(!post.photos.length) continue;
      const article=post.articles.length===1?post.articles[0]:null;
      const candidates=index.get(article)||[];
      if(!article||candidates.length!==1) {
        report.issues.push({postId:post.id,article,reason:!article?'no-single-article':candidates.length?'ambiguous-product':'no-product'});continue;
      }
      const productId=String(candidates[0]._id);
      report.matched.push({postId:post.id,article,productId,name:candidates[0].name,source:post.source,photos:post.photos});
      if(!values.apply) continue;
      for(const url of post.photos) {
        const hostname=new URL(url).hostname;
        if(!/^(?:cdn\d+\.)?telesco\.pe$/.test(hostname)) throw new Error('Unexpected Telegram media host.');
        const image=await fetch(url,{signal:AbortSignal.timeout(30000)});
        if(!image.ok||!image.headers.get('content-type')?.startsWith('image/')) throw new Error('Telegram photo download failed.');
        const data=Buffer.from(await image.arrayBuffer());
        if(data.length>20*1024*1024) throw new Error('Photo exceeds upload limit.');
        const sha256=createHash('sha256').update(data).digest('hex');const key=`${productId}:${sha256}`;
        if(hashes.has(key)){report.alreadyLinked++;continue;}
        const file=path.join(temporary,`${sha256}.jpg`);await writeFile(file,data);
        const asset=await uploadPhoto(file,article,sha256);
        await Sneacker.updateOne({_id:productId,'telegramPhotos.sha256':{$ne:sha256}},{$push:{telegramPhotos:{...asset,sha256,sourceChatId:values.channel,sourceMessageId:String(post.id)}}});
        hashes.add(key);report.uploaded++;await rm(file);
      }
    }
    if(report.pages%20===0) {
      await writeFile(values.report,JSON.stringify(report,null,2));
      console.log(JSON.stringify({pages:report.pages,posts:report.posts,matched:report.matched.length,uploaded:report.uploaded}));
    }
    if(!parsed.before){report.complete=true;break;}
    if(before&&parsed.before>=before) throw new Error('Telegram pagination did not advance.');
    before=parsed.before;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
} catch(error) {
  report.failed=true;
  let message=String(error.error?.message||error.message||'Import failed');
  for(const [key,value] of Object.entries(process.env)) if(value&&/KEY|SECRET|URL|CLOUDINARY/.test(key)) message=message.replaceAll(value,`[${key}]`);
  report.error=message;process.exitCode=1;console.error(message);
} finally {
  await mongoose.disconnect();if(temporary) await rm(temporary,{recursive:true,force:true});
  await mkdir(path.dirname(path.resolve(values.report)),{recursive:true});
  await writeFile(values.report,JSON.stringify(report,null,2));
  console.log(JSON.stringify({pages:report.pages,posts:report.posts,matchedPosts:report.matched.length,matchedProducts:new Set(report.matched.map(p=>p.productId)).size,photos:report.matched.reduce((n,p)=>n+p.photos.length,0),uploaded:report.uploaded,complete:report.complete}));
}
