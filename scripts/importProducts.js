import 'dotenv/config';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { algoliaClient, INDEX_NAME } from '../src/config/algolia.js';
import { mapProductToAlgolia } from '../src/mappers/algoliaMapper.js';
import { Sneacker } from '../src/models/sneacker.js';
import { parseEasydrop, stockUpdateOperations } from '../src/services/import/easydrop.js';
import { planCatalogSync, cleanupEntry, cleanupAssets } from '../src/services/import/catalogSync.js';
import { productArticle } from '../src/services/import/article.js';
import { configureCloudinary } from '../src/services/import/cloudinary.js';
const { values } = parseArgs({options:{apply:{type:'boolean',default:false}}});
const report = { dryRun: !values.apply, stage:'fetch', deletedPhotos:0 };
try {
  if (!process.env.EASYDROP_FEED_URL) throw new Error('Missing feed configuration.');
  const response = await fetch(process.env.EASYDROP_FEED_URL, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Feed request failed.');
  const incoming = await parseEasydrop(await response.text());
  report.stage='validate';
  await mongoose.connect(process.env.MONGODB_URL, { serverSelectionTimeoutMS: 15000 });
  const existing = await Sneacker.find({}).lean();
  const plan = planCatalogSync(incoming, existing);
  Object.assign(report,{feedProducts:incoming.length,activeProducts:plan.active.length,newProducts:plan.newProducts,removedProducts:plan.removed.length});
  if(values.apply){
    const cloud = configureCloudinary();
    const queue = mongoose.connection.collection('catalog_asset_cleanup');
    report.stage='update-products';
    if(plan.active.length) await Sneacker.bulkWrite(stockUpdateOperations(plan.active));
    // Persist deletion intent before removing the product, so a crash never loses cleanup work.
    for(const product of plan.removed){
      const entry=cleanupEntry(product);
      await queue.updateOne({_id:entry._id},{$set:{article:entry.article},$addToSet:{publicIds:{$each:entry.publicIds}}},{upsert:true});
    }
    report.stage='remove-search-records';
    if(plan.removed.length){
      await algoliaClient.deleteObjects({indexName:INDEX_NAME,objectIDs:plan.removed.map(p=>String(p._id)),waitForTasks:true});
      await Sneacker.deleteMany({_id:{$in:plan.removed.map(p=>p._id)}});
    }
    report.stage='update-search';
    const all=await Sneacker.find({}).lean();
    if(all.length) await algoliaClient.saveObjects({indexName:INDEX_NAME,objects:all.map(mapProductToAlgolia),waitForTasks:true});
    report.stage='cleanup-photos';
    for await(const entry of queue.find({})){
      report.deletedPhotos+=await cleanupAssets(entry,{
        isActive: async e => all.some(p=>p.groupId===e._id || (e.article && productArticle(p.barcode)===e.article)),
        listAssets: async prefix => {
          const ids=[];let cursor;
          do {const page=await cloud.api.resources({type:'upload',resource_type:'image',prefix,max_results:500,...(cursor?{next_cursor:cursor}:{})});ids.push(...page.resources.map(p=>p.public_id));cursor=page.next_cursor;}while(cursor);
          return ids;
        },
        isReferenced: async id => Boolean(await Sneacker.exists({'telegramPhotos.publicId':id})),
        destroy: id => cloud.uploader.destroy(id,{resource_type:'image',invalidate:true}),
        complete: id => queue.deleteOne({_id:id}),
      });
    }
  }
  report.stage='complete';
} catch {
  report.failed=true;process.exitCode=1;
  console.error(`Catalog sync failed at ${report.stage}. Check feed integrity and service access. No secrets are included in this log.`);
} finally {
  await mongoose.disconnect();
  await mkdir('sync-reports',{recursive:true});
  await writeFile('sync-reports/catalog.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
