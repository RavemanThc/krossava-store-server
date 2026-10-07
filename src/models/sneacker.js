import { mapProductToAlgolia } from '../mappers/algoliaMapper.js';
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

const syncProduct = async (doc) => {
  if (doc) await algoliaClient.saveObjects({ indexName: INDEX_NAME, objects: [mapProductToAlgolia(doc)] });
};
productSchema.post('save', syncProduct);
productSchema.post('findOneAndUpdate', syncProduct);
productSchema.post('findOneAndDelete', async function (doc) {
  if (doc) await algoliaClient.deleteObjects({ indexName: INDEX_NAME, objectIDs: [String(doc._id)] });
});

export const Sneacker = model('Product', productSchema);
