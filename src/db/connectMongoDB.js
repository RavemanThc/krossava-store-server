import mongoose from 'mongoose';
import { Sneacker } from '../models/sneacker.js';

export const connectMongoDB = async () => {
  try {
    const mongoUrl = process.env.MONGODB_URL;
    await mongoose.connect(mongoUrl);
    await Sneacker.syncIndexes();
  } catch (error) {
    console.log(error.message);
    process.exit(1);
  }
};
