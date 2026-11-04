import 'dotenv/config';
import mongoose from 'mongoose';
import {Sneacker} from '../src/models/sneacker.js';
import {algoliaClient,INDEX_NAME} from '../src/config/algolia.js';
import {mapProductToAlgolia} from '../src/mappers/algoliaMapper.js';
try {
  await mongoose.connect(process.env.MONGODB_URL,{serverSelectionTimeoutMS:15000});
  const products=await Sneacker.find({}).lean();
  if(!products.length)throw new Error('Empty catalogue');
  const settings=await algoliaClient.getSettings({indexName:INDEX_NAME});
  const names=['category','brand','model','sizes','inStock'];
  const previous=(settings.attributesForFaceting || []).filter(v=>!names.includes(v.replace(/(?:filterOnly|searchable|afterDistinct)\(/g,'').replace(/\)/g,'')));
  const task=await algoliaClient.setSettings({indexName:INDEX_NAME,indexSettings:{attributesForFaceting:[...previous,...names]},forwardToReplicas:true});
  await algoliaClient.waitForTask({indexName:INDEX_NAME,taskID:task.taskID});
  const records=products.map(mapProductToAlgolia);
  await algoliaClient.saveObjects({indexName:INDEX_NAME,objects:records,waitForTasks:true});
  console.log(JSON.stringify({indexed:records.length,withoutBrand:records.filter(p=>!p.brand).length,withoutModel:records.filter(p=>!p.model).length}));
}catch{console.error('Filter index configuration failed. Check Algolia and MongoDB access.');process.exitCode=1;}
finally{await mongoose.disconnect();}
