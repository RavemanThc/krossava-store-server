import { algoliasearch } from 'algoliasearch';
import dotenv from 'dotenv';
dotenv.config();

export const algoliaClient = algoliasearch(
  process.env.ALGOLIA_APP_ID,
  process.env.ALGOLIA_ADMIN_KEY,
);

export const INDEX_NAME = 'sneakers_index';
