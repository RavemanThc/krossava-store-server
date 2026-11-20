import { syncSearchProducts } from '../services/search/sync.js';
import { model, Schema } from 'mongoose';

const productSchema = new Schema(
  {
    groupId: String,
    name: String,
    category: String,
    price: Number,
    image: String,
    // Easydrop owns image and stock; Telegram only adds gallery photos.
    telegramPhotos: [{
      _id: false,
      url: String,
      publicId: String,
      sha256: String,
      sourceChatId: String,
      sourceMessageId: String,
      sourceThreadId: String,
    }],
    lastSyncAt: Date,
    sizeChart: {
      rows: [{ _id: false, size: String, cm: Number }],
      sourceChatId: String,
      sourceMessageId: String,
      sourceDate: Date,
      syncedAt: Date,
    },
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
  if (doc) await syncSearchProducts([doc]);
};
productSchema.post('save', syncProduct);
productSchema.post('findOneAndUpdate', syncProduct);
productSchema.post('findOneAndDelete', async function (doc) {
  if (doc) await syncSearchProducts([], [String(doc._id)]);
});

export const Sneacker = model('Product', productSchema);
