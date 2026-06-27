import axios from 'axios';
import mongoose from 'mongoose';
import { parseStringPromise } from 'xml2js';
import { Sneacker } from '../src/models/sneacker.js';
import dotenv from 'dotenv';

dotenv.config();

await mongoose.connect(process.env.MONGODB_URL);

const { data: xml } = await axios.get(
  'https://easydrop.one/prom-export?key=19100792694610&pid=14190490311056',
);

const result = await parseStringPromise(xml);

const categories = {};
result.shop.catalog[0].category.forEach((cat) => {
  categories[cat.$.id] = cat._;
});

const items = result.shop.items[0].item;

const grouped = {};

items.forEach((item) => {
  const groupId = item.$.group_id;

  if (!grouped[groupId]) {
    grouped[groupId] = {
      groupId,
      name: item.name[0].replace(/\s\d+$/, ''),
      category: categories[item.categoryId[0]],
      price: Number(item.priceuah[0]),
      image: item.image[0],
      description: item.description[0],
      barcode: item.barcode?.[0] ?? null,
      sizes: [],
    };
  }

  const sizeParam = item.param.find((p) => p.$?.name === 'Розмір');

  grouped[groupId].sizes.push({
    size: sizeParam?._ || '',
    quantity: Number(item.quantity_in_stock[0]),
    itemId: item.$.id,
  });
});

await Sneacker.bulkWrite(
  Object.values(grouped).map((product) => ({
    updateOne: {
      filter: { groupId: product.groupId },
      update: {
        $set: product,
        $setOnInsert: { createdAt: new Date() },
        lastSyncAt: new Date(),
      },
      upsert: true,
    },
  })),
);

console.log(`Импортировано ${Object.keys(grouped).length} товаров`);
