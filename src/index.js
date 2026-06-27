import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import sneackerRouters from './routers/sneackerRourters.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFoundPageHandler } from './middlewares/notFoundHandler.js';
import { logger } from './middlewares/logger.js';
import { connectMongoDB } from './db/connectMongoDB.js';
import { errors } from 'celebrate';

import orderTelegram from './routers/orderTelegram.js';

const app = express();
const PORT = process.env.PORT ?? 3000;
app.use(logger);
app.use(
  express.json({
    type: ['application/json', 'application/vnd.api+json'],
  }),
);

app.use(
  cors({
    origin: 'https://krossava.com.ua',
  }),
);

app.use(sneackerRouters);
app.use(orderTelegram);
app.use(notFoundPageHandler);
app.use(errors());
app.use(errorHandler);
await connectMongoDB();
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
