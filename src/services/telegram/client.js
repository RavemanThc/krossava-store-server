import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const sessionFile = path.resolve('.telegram/session.txt');
export async function makeTelegramClient() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) throw new Error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH in server .env.');
  let session = process.env.TELEGRAM_SESSION?.trim() || '';
  if (!session) {
  try { session = (await readFile(sessionFile, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3, floodSleepThreshold: 60 });
  client.setLogLevel('none');
  return client;
}
