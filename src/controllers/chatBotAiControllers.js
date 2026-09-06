import { algoliaClient, INDEX_NAME } from '../config/algolia.js';
import { CHAT_RATE_LIMIT_WINDOW, redis } from '../config/redis.js';
import { mapProductToDTO } from '../mappers/productMapper.js';

export const searchProductsForAI = async (req, res) => {
  const {
    query = '',
    size,
    gender,
    category,
    minPrice,
    maxPrice,
    limit = 6,
    sortOrder,
  } = req.query;

  const filterArray = [];

  if (category) {
    filterArray.push(`category:"${category}"`);
  }

  if (size) {
    filterArray.push(`sizes:"${size}"`);
  } else if (gender === 'women') {
    filterArray.push(
      '(sizes:"36" OR sizes:"37" OR sizes:"38" OR sizes:"39" OR sizes:"40")',
    );
  }

  if (minPrice || maxPrice) {
    const min = Number(minPrice) || 0;
    const max = Number(maxPrice) || 999999;

    filterArray.push(`price:${min} TO ${max}`);
  }

  const searchOptions = {
    indexName: INDEX_NAME,
    query: String(query),
    page: 0,
    hitsPerPage: Math.min(Math.max(Number(limit) || 6, 1), 10),
  };

  if (filterArray.length) {
    searchOptions.filters = filterArray.join(' AND ');
  }

  if (sortOrder === 'asc') {
    searchOptions.indexName = 'sneakers_index_price_asc';
  }

  if (sortOrder === 'desc') {
    searchOptions.indexName = 'sneakers_index_price_desc';
  }

  const searchResponse = await algoliaClient.search({
    requests: [searchOptions],
  });

  const result = searchResponse.results[0];

  const products = result.hits?.map(mapProductToDTO) ?? [];

  return res.status(200).json({
    total: result.nbHits,
    count: products.length,
    products,
  });
};

export const sendChatMessage = async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({
        message: 'Повідомлення не може бути порожнім.',
        products: [],
      });
    }

    const response = await fetch(process.env.N8N_CHATBOT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        sessionId,
      }),
    });

    if (!response.ok) {
      const text = await response.text();

      console.error('n8n error:', response.status, text);

      return res.status(502).json({
        message: 'Не вдалося отримати відповідь. Спробуйте ще раз.',
        products: [],
      });
    }

    const data = await response.json();
    let products = data.products;

    if (typeof products === 'string') {
      try {
        products = JSON.parse(products);
      } catch {
        products = [];
      }
    }

    if (!Array.isArray(products)) {
      products = [];
    }
    const key = req.chatRateLimitKey;

    if (key) {
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, CHAT_RATE_LIMIT_WINDOW);
      }
    }

    return res.status(200).json({
      ...data,
      products,
    });
  } catch (error) {
    console.error('Chat controller error:', error);

    return res.status(500).json({
      message: 'Не вдалося отримати відповідь. Спробуйте ще раз.',
      products: [],
    });
  }
};
