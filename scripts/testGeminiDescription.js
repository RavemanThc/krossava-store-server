import 'dotenv/config';
import { researchProduct } from '../src/services/ai/productResearch.js';
import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { descriptionFacts, generateProductDescription } from '../src/services/ai/productDescription.js';

try {
  const { values } = parseArgs({ options: { product: { type: 'string' }, model: { type: 'string' }, 'supplier-only': { type: 'boolean', default: false } } });
  if (!/^[a-f0-9]{24}$/i.test(values.product || '')) throw new Error('Use --product <MongoDB product ID>');
  await mongoose.connect(process.env.MONGODB_URL, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
  const product = await mongoose.connection.collection('products').findOne(
    { _id: new mongoose.Types.ObjectId(values.product) }, { projection: { name: 1, description: 1 } },
  );
  await mongoose.disconnect();
  if (!product) throw new Error('Product not found');
  const options = { ...(values.model ? { model: values.model } : {}) };
  const research = values['supplier-only'] ? null : await researchProduct(product, options);
  const result = await generateProductDescription(product, { ...options, research });
  const report = { productId: String(product._id), name: product.name, createdAt: new Date().toISOString(),
    sourceHash: createHash('sha256').update(JSON.stringify(descriptionFacts(product))).digest('hex'),
    source: descriptionFacts(product), research, ...result, requiresReview: true, applied: false };
  await mkdir('sync-reports', { recursive: true });
  const path = `sync-reports/gemini-description-${values.product}-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ path, ...result, research: research ? { match: research.match, usable: research.usable, sources: research.sources, conflicts: research.conflicts } : null, applied: false }, null, 2));
} catch (error) {
  // Avoid exposing MongoDB URIs, API response bodies or headers in logs.
  const message = String(error.message || '');
  console.error(/^(Use --product|Product not found|Missing GEMINI|Invalid Gemini|Invalid product|Product name|Gemini )/.test(message)
    ? message : 'Description preview failed; check database access and local configuration');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
