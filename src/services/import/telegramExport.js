import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extractArticles } from './article.js';

export const messageText = message => typeof message.text === 'string' ? message.text
  : (message.text || []).map(part => typeof part === 'string' ? part : part.text || '').join('');

export function planTelegramPhotos(chats, productsByArticle) {
  const issues = [];
  const threads = new Map();
  for (const chat of chats) {
    // Channel photos are explicitly excluded, including the forwarded root photo.
    if (String(chat.type || '').includes('channel')) continue;
    const messages = new Map(chat.messages.map(m => [String(m.id), m]));
    const groups = new Map();
    for (const message of chat.messages) {
      const group = message.grouped_id ?? message.media_group_id;
      if (group !== undefined) groups.set(String(group), [...(groups.get(String(group)) || []), message]);
    }
    function resolve(message, visited = new Set()) {
      const id = String(message.id);
      if (visited.has(id)) return { error: 'reply-cycle' };
      const own = extractArticles(messageText(message));
      if (own.length > 1) return { error: 'multiple-articles' };
      if (message.reply_to_message_id === undefined) {
        return own.length === 1 ? { code: own[0], thread: message } : { error: 'no-article-or-missing-parent' };
      }
      const parent = messages.get(String(message.reply_to_message_id));
      if (!parent) return { error: 'no-article-or-missing-parent' };
      const inherited = resolve(parent, new Set(visited).add(id));
      if (inherited.error) return inherited;
      if (own[0] && own[0] !== inherited.code) return { error: 'conflicting-reply-article' };
      return inherited;
    }
    for (const message of chat.messages) {
      if (!message.photo) continue;
      const group = message.grouped_id ?? message.media_group_id;
      const peers = group !== undefined ? groups.get(String(group)) || [] : [];
      const replies = message.reply_to_message_id !== undefined ? [message]
        : peers.filter(m => m.reply_to_message_id !== undefined);
      if (!replies.length) continue; // Never use the main photo or neighbouring posts.
      const results = replies.map(m => resolve(m));
      let resolved = results[0];
      if (results.some(r => r.error)) resolved = results.find(r => r.error);
      else if (new Set(results.map(r => String(r.thread.id))).size > 1) resolved = { error: 'conflicting-album-articles' };
      const own = extractArticles(messageText(message));
      if (own.length > 1 || (own[0] && own[0] !== resolved.code)) resolved = { error: 'conflicting-reply-article' };
      const source = { chatId: String(chat.id), messageId: String(message.id) };
      const products = productsByArticle.get(resolved.code) || [];
      const reason = resolved.error || (!products.length ? 'no-product' : products.length > 1 ? 'ambiguous-product' : null);
      if (reason) { issues.push({ ...source, article: resolved.code, reason }); continue; }
      const productId = String(products[0]._id);
      const key = `${chat.id}:${resolved.thread.id}:${productId}`;
      if (!threads.has(key)) threads.set(key, {
        productId, threadId: Number(resolved.thread.id),
        time: Number(resolved.thread.date_unixtime) * 1000 || Date.parse(resolved.thread.date || '') || 0,
        photos: [],
      });
      threads.get(key).photos.push({ ...source, article: resolved.code, productId,
        threadId: String(resolved.thread.id), file: message.photo, root: chat.root });
    }
  }
  // Reposts of the same product: use the latest available discussion, never mix threads.
  const newest = new Map();
  for (const thread of threads.values()) {
    const previous = newest.get(thread.productId);
    if (!previous || thread.time > previous.time || (thread.time === previous.time && thread.threadId > previous.threadId)) newest.set(thread.productId, thread);
  }
  const photos = [...newest.values()].flatMap(thread => thread.photos
    .sort((a, b) => Number(a.messageId) - Number(b.messageId))
    .filter((photo, index, all) => all.findIndex(p => p.messageId === photo.messageId) === index)
    .slice(0, 10));
  return { photos, issues };
}

export async function readTelegramExport(input) {
  const absolute = path.resolve(input);
  const jsonPath = (await stat(absolute)).isDirectory() ? path.join(absolute, 'result.json') : absolute;
  const data = JSON.parse(await readFile(jsonPath, 'utf8'));
  const chats = data.chats?.list || (Array.isArray(data.messages) ? [data] : []);
  if (!chats.length) throw new Error('Export must contain Telegram JSON messages (result.json).');
  return chats.map(chat => ({ ...chat, root: path.dirname(jsonPath) }));
}

export async function safePhotoPath(root, relative) {
  if (path.isAbsolute(relative)) throw new Error('Photo path must be relative to the export.');
  const base = await realpath(root);
  const file = await realpath(path.resolve(base, relative));
  const inside = path.relative(base, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Photo is outside the export.');
  const info = await stat(file);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Photo is missing or exceeds 20 MB.');
  return file;
}
