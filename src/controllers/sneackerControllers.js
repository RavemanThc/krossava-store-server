import createHttpError from 'http-errors';
import { mapProductToDTO } from '../mappers/productMapper.js';
import { Sneacker } from '../models/sneacker.js';
// import normalizeSearchText from '../services/search/normalize.js';
import { algoliaClient, INDEX_NAME } from '../config/algolia.js';

export const getSneackers = async (req, res) => {
  const {
    page = 1,
    perPage = 10,
    category,
    search = '', // по умолчанию пустая строка
    minPrice,
    maxPrice,
    size,
    sortBy = '_id',
    sortOrder = 'asc',
  } = req.query;

  try {
    const pageNum = Math.max(1, parseInt(page, 10) || 1) - 1; // Algolia пагинация с 0
    const perPageNum = Math.min(50, Math.max(1, parseInt(perPage, 10) || 10));

    // 1. Динамически собираем фильтры
    const filterArray = [];
    if (category) filterArray.push(`category:"${category}"`);
    if (size) {
      filterArray.push(`sizes:"${size}"`);
    }
    if (minPrice || maxPrice) {
      const min = minPrice || 0;
      const max = maxPrice || 999999;
      filterArray.push(`price:${min} TO ${max}`);
    }
    // 2. Базовый объект настроек для Algolia
    const searchOptions = {
      indexName: INDEX_NAME,
      query: String(search), // гарантируем, что это строка, даже если пришел пустой запрос
      page: pageNum,
      hitsPerPage: perPageNum,
    };

    // Добавляем фильтры в настройки ТОЛЬКО если они реально есть
    if (filterArray.length > 0) {
      searchOptions.filters = filterArray.join(' AND ');
    }

    // 3. Обработка индекса сортировки
    // Если сортировка по цене — переключаемся на индекс-реплику (если они настроены в Algolia)
    if (sortBy === 'price') {
      searchOptions.indexName =
        sortOrder === 'desc'
          ? 'sneakers_index_price_desc'
          : 'sneakers_index_price_asc';
    }

    // 4. Отправляем запрос в Algolia v5
    const searchResponse = await algoliaClient.search({
      requests: [searchOptions],
    });

    const result = searchResponse.results[0];
    console.log('category:', category);
    console.log('filters:', `category:"${category}"`);
    // 5. Возвращаем успешный ответ
    return res.status(200).json({
      page: result.page + 1,
      perPage: result.hitsPerPage,
      totalItems: result.nbHits,
      totalPages: result.nbPages,
      products: result.hits ? result.hits.map(mapProductToDTO) : [],
    });
  } catch (error) {
    // ВАЖНО: Текущая ошибка выведется в терминал твоего бэкенда! Посмотри туда, если снова упадет.
    console.error('--- [ОШИБКА ALGOLIA] ---');
    console.error(error);
    console.error('------------------------');

    return res.status(500).json({
      message: 'Ошибка работы поискового движка',
      details: error.message,
    });
  }
};
//
//
//
export const getSneackerById = async (req, res) => {
  const { id } = req.params;
  const sneacker = await Sneacker.findById(id);
  if (!sneacker) {
    createHttpError(404, 'Sneacker not found');
  }
  res.status(200).json(sneacker);
};
//
//
//
export const getCategories = async (req, res) => {
  const categories = (await Sneacker.distinct('category')).filter(
    (c) => !c.includes('🔥 Sale | від 899 грн  | останні розміри 🔥'),
  );
  res.json(categories);
};
//
//
//
export const createNewSneacker = async (req, res) => {
  const sneacker = await Sneacker.create(req.body);

  res.status(200).json(sneacker);
};
//
//
//
export const deleateSneackerItem = async (req, res) => {
  const { id } = req.params;
  const sneacker = await Sneacker.findOneAndDelete({ _id: id });
  if (!sneacker) {
    throw createHttpError(404, 'Sneaker not found');
  }
  res.status(200).json(sneacker);
};
//
//
//
export const pathSneackerItem = async (req, res) => {
  const { id } = req.params;
  const sneacker = await Sneacker.findOneAndUpdate({ _id: id }, req.body, {
    returnDocument: 'after',
  });
  if (!sneacker) {
    throw createHttpError(404, 'Sneacker not found');
  }
  res.status(200).json(sneacker);
};
