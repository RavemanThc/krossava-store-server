import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Sneacker } from '../src/models/sneacker.js';
import { algoliaClient, INDEX_NAME } from '../src/config/algolia.js';

dotenv.config();

await mongoose.connect(process.env.MONGODB_URL);

const products = await Sneacker.find();

const objects = products.map((product) => ({
  objectID: product._id.toString(), // <-- главное
  groupId: product.groupId,
  name: product.name,
  category: product.category,
  price: product.price,
  image: product.image,
  description: product.description,
  barcode: product.barcode,
  sizes: product.sizes.map((s) => s.size),
}));

await algoliaClient.saveObjects({
  indexName: INDEX_NAME,
  objects,
});

console.log(`Algolia updated: ${objects.length} products`);

await mongoose.disconnect();
