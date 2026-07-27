import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Sneacker } from '../src/models/sneacker.js';
import { algoliaClient, INDEX_NAME } from '../src/config/algolia.js';

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    console.log('✅ MongoDB connected');

    const sneakers = await Sneacker.find().lean();

    console.log(`📦 Найдено ${sneakers.length} товаров`);

    if (!sneakers.length) {
      console.log('MongoDB пуста');
      process.exit(0);
    }

    const objects = sneakers.map((doc) => ({
      objectID: doc.groupId, // лучше использовать groupId
      groupId: doc.groupId,
      name: doc.name,
      category: doc.category,
      price: doc.price,
      image: doc.image,
      description: doc.description,
      barcode: doc.barcode,
      sizes: doc.sizes.map((s) => s.size),
    }));

    console.log('🗑 Очищаем индекс Algolia...');
    await algoliaClient.clearObjects({
      indexName: INDEX_NAME,
    });

    console.log('⬆️ Загружаем товары...');
    await algoliaClient.saveObjects({
      indexName: INDEX_NAME,
      objects,
    });

    console.log(`✅ Импортировано ${objects.length} товаров в Algolia`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
