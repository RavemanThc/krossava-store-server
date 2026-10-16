import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { makeTelegramClient, sessionFile } from '../src/services/telegram/client.js';
if (!process.stdin.isTTY) throw new Error('Run this login locally in an interactive terminal.');
const hiddenOutput = new Writable({ write(_chunk, _encoding, done) { done(); } });
const terminal = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true });
async function ask(label) { process.stdout.write(label);const answer=await terminal.question('');process.stdout.write('\n');return answer.trim(); }
let client;
try {
  client = await makeTelegramClient();
  await client.start({
    phoneNumber: () => ask('Номер Telegram (+код страны): '),
    phoneCode: () => ask('Код входа из Telegram: '),
    password: () => ask('Пароль двухэтапной проверки (если запрошен): '),
    onError: async error => { console.error(error.errorMessage || 'Telegram login failed'); return true; },
  });
  if (!await client.checkAuthorization()) throw new Error('Login was not completed.');
  await mkdir(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
  await writeFile(sessionFile, client.session.save(), { mode: 0o600 });
  await chmod(sessionFile, 0o600);
  console.log('Telegram connected. Session saved locally; do not share the session file.');
} finally { terminal.close();if(client)await client.disconnect(); }
