import { model, Schema } from 'mongoose';
import { algoliaClient, INDEX_NAME } from '../config/algolia.js';

const productSchema = new Schema(
  {
    groupId: String,
    name: String,
    category: String,
    price: Number,
    image: String,
    description: String,
    barcode: String,
    sizes: [
      {
        size: String,
        quantity: Number,
        itemId: String,
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// индексы MongoDB
productSchema.index({ name: 1 });
productSchema.index({ category: 1 });
productSchema.index({ price: 1 });
productSchema.index({ 'sizes.size': 1 });
productSchema.index({ groupId: 1 }, { unique: true });
productSchema.index({ createdAt: -1 });

// ================= СИНХРОНИЗАЦИЯ С ALGOLIA (v5) =================

// 1. Хук на сохранение/обновление товара
productSchema.post('save', async function (doc) {
  try {
    await algoliaClient.saveObjects({
      indexName: INDEX_NAME,
      objects: [
        {
          objectID: doc._id.toString(), // Обязательный ID для Algolia
          groupId: doc.groupId,
          name: doc.name,
          category: doc.category,
          price: doc.price,
          image: doc.image,
          description: doc.description,
          barcode: doc.barcode,
          // Превращаем массив объектов [{size: "42", quantity: 5}]
          // в плоский массив строк ["42", "43", "44"], чтобы Algolia могла по нему фильтровать
          sizes: doc.sizes ? doc.sizes.map((s) => s.size) : [],
        },
      ],
    });
    console.log(`[Algolia] Товар ${doc._id} успешно синхронизирован.`);
  } catch (error) {
    console.error('[Algolia] Ошибка при сохранении объекта:', error);
  }
});

// 2. Хук на удалениетовара
productSchema.post('findOneAndDelete', async function (doc) {
  if (doc) {
    try {
      await algoliaClient.deleteObjects({
        indexName: INDEX_NAME,
        objectIDs: [doc._id.toString()],
      });
      console.log(`[Algolia] Товар ${doc._id} успешно удален из индекса.`);
    } catch (error) {
      console.error('[Algolia] Ошибка при удалении объекта:', error);
    }
  }
});

export const Sneacker = model('Product', productSchema);
