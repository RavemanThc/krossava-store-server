import { load } from 'cheerio';
import { extractArticles } from './article.js';

export function parsePublicPage(html, channel) {
  const $ = load(html);
  const posts = [];
  $('.tgme_widget_message[data-post]').each((_, element) => {
    const message = $(element);
    const source = message.attr('data-post');
    if (!source?.startsWith(`${channel}/`)) return;
    const id = Number(source.split('/')[1]);
    const text = message.find('.tgme_widget_message_text').text();
    const urls = [];
    message.find('.tgme_widget_message_photo_wrap').each((_, image) => {
      const style = $(image).attr('style') || '';
      const url = style.match(/background-image\s*:\s*url\(['"]?(https:[^'"\s)]+)['"]?\)/)?.[1];
      if (url) urls.push(url);
    });
    if (Number.isSafeInteger(id)) posts.push({ id, text, articles: extractArticles(text), photos: [...new Set(urls)], source: `https://t.me/${source}` });
  });
  const before = Number($('.tme_messages_more[data-before]').attr('data-before')) || null;
  return { posts, before };
}
