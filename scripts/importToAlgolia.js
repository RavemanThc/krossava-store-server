import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Sneacker } from '../src/models/sneacker.js';
import { algoliaClient, INDEX_NAME } from '../src/config/algolia.js';
dotenv.config();

async function run() {
  try {
    // 1. Подключаемся к твоей MongoDB
    // Замени URL на свой, если он берется из .env, используй process.env.MONGODB_URL
    const mongoUrl =
      process.env.MONGODB_URL || 'mongodb://localhost:27017/твоя_бд';
    await mongoose.connect(mongoUrl);
    console.log('Успешно подключено к MongoDB...');

    // 2. Забираем ВСЕ товары из базы данных
    const sneakers = await Sneacker.find({});
    console.log(`Найдено ${sneakers.length} товаров в MongoDB для импорта.`);

    if (sneakers.length === 0) {
      console.log('База данных MongoDB пуста. Нечего импортировать.');
      process.exit(0);
    }

    // 3. Маппим данные под структуру, которую мы заложили в хуках
    const objectsToSync = sneakers.map((doc) => ({
      objectID: doc._id.toString(), // Algolia требует string-ключ objectID
      groupId: doc.groupId,
      name: doc.name,
      category: doc.category,
      price: doc.price,
      image: doc.image,
      description: doc.description,
      barcode: doc.barcode,
      sizes: doc.sizes ? doc.sizes.map((s) => s.size) : [],
    }));

    // 4. Отправляем всю пачку в Algolia v5
    console.log(`Отправляем данные в индекс "${INDEX_NAME}"...`);
    await algoliaClient.saveObjects({
      indexName: INDEX_NAME,
      objects: objectsToSync,
    });

    console.log(
      `✨ Успех! Все ${objectsToSync.length} товаров перенесены в Algolia.`,
    );
    process.exit(0);
  } catch (error) {
    console.error('Ошибка во время импорта:', error);
    process.exit(1);
  }
}

run();
