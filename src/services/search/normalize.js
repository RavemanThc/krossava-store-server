const BRAND_MODEL_DICTIONARY = [
  // ================= AIR JORDAN =================
  {
    keywords: /джордан[ыеау]?|жордан[ы]?|мид[ы]?|high\b/gi,
    replacement: 'jordan',
  },

  // ================= NIKE =================
  { keywords: /найк[иеауов]?|наик[и]?/gi, replacement: 'nike' },
  { keywords: /(^|\s)най(\s|$)/gi, replacement: '$1nike$2' },
  // Модели Nike
  { keywords: /эйр\s?макс[ы]?|айрмакс[ы]?|макс[ы]?/gi, replacement: 'air max' },
  {
    keywords: /форс[ыауе]?|эир\s?форс[ы]?|данки|данк/gi,
    replacement: 'air force dunk',
  }, // объединяем частые форсы/данки
  { keywords: /корт\s?вижн|кортвижн/gi, replacement: 'court vision' },

  // ================= ADIDAS =================
  { keywords: /ад[иа]д[ао]с[ыауем]?|адик[и]?/gi, replacement: 'adidas' },
  { keywords: /(^|\s)ади(\s|$)/gi, replacement: '$1adidas$2' },
  // Модели Adidas
  { keywords: /изи[ки]?|буст[ы]?|350|700/gi, replacement: 'yeezy boost' },
  { keywords: /самб[ыауе]?/gi, replacement: 'samba' },
  { keywords: /газел[иьуя]?|газелл[и]?/gi, replacement: 'gazelle' },
  { keywords: /кампус[ы]?/gi, replacement: 'campus' },
  { keywords: /суперстар[ы]?/gi, replacement: 'superstar' },

  // ================= NEW BALANCE =================
  {
    keywords: /нью\s?бэланс[ы]?|ньюбики|нб|new\s?balance/gi,
    replacement: 'new balance',
  },
  // Модели NB
  { keywords: /574|530|990|1906/gi, replacement: (match) => match }, // цифры оставляем как есть

  // ================= ASICS =================
  { keywords: /асик[сснияуе]?|асики/gi, replacement: 'asics' },
  // Модели Asics
  {
    keywords: /гель\s?лайт|гели|кайано|kayano|gel-kayano/gi,
    replacement: 'gel',
  },

  // ================= PUMA =================
  { keywords: /пум[аыуе]/gi, replacement: 'puma' },
  // Модели Puma
  { keywords: /замш[ауе]|суед|суэйд/gi, replacement: 'suede' },

  // ================= REEBOK =================
  { keywords: /рибок[и]?|рибек/gi, replacement: 'reebok' },
  // Модели Reebok
  { keywords: /классик[и]?/gi, replacement: 'classic' },

  // ================= VANS / CONVERSE =================
  { keywords: /ванс[ыае]?|кеды\s?ванс/gi, replacement: 'vans' },
  { keywords: /конверс[ыае]?|конвера|конверсы/gi, replacement: 'converse' },
];

const CYRILLIC_TO_LATIN = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ы: 'y',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function normalizeSearchText(text) {
  if (!text || typeof text !== 'string') return '';

  let result = text.toLowerCase().trim();
  let matchedAny = false;

  BRAND_MODEL_DICTIONARY.forEach(({ keywords, replacement }) => {
    if (keywords.test(result)) {
      result = result.replace(keywords, replacement);
      matchedAny = true;
    }
  });

  if (!matchedAny) {
    result = result
      .split('')
      .map((char) => CYRILLIC_TO_LATIN[char] || char)
      .join('');
  }

  return result.replace(/\s+/g, ' ').trim();
}

export default normalizeSearchText;
