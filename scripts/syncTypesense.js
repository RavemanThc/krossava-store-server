import 'dotenv/config';
import mongoose from 'mongoose';
import { Sneacker } from '../src/models/sneacker.js';
import { typesenseWritesEnabled, upsertTypesenseProducts } from '../src/services/search/typesense.js';
try {
  if (!typesenseWritesEnabled()) throw new Error('Missing Typesense write configuration');
  await mongoose.connect(process.env.MONGODB_URL, { serverSelectionTimeoutMS: 15000 });
  let batch = [], indexed = 0;
  for await (const product of Sneacker.find({}).lean().cursor()) {
    batch.push(product);
    if (batch.length === 100) { await upsertTypesenseProducts(batch); indexed += batch.length; batch = []; }
  }
  if (batch.length) { await upsertTypesenseProducts(batch); indexed += batch.length; }
  console.log(JSON.stringify({ indexed }));
} catch {
  console.error('Typesense sync failed. Check collection, MongoDB and write-key configuration.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
