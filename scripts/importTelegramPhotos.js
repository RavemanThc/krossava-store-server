import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { Sneacker } from '../src/models/sneacker.js';
import { indexProducts } from '../src/services/import/article.js';
import { readTelegramExport, planTelegramPhotos, safePhotoPath } from '../src/services/import/telegramExport.js';
import { createR2Storage } from '../src/services/import/r2.js';

const { values } = parseArgs({ options: {
  export: { type: 'string', multiple: true },
  apply: { type: 'boolean', default: false },
  report: { type: 'string', default: 'telegram-import-report.json' },
} });
if (!values.export?.length) throw new Error('Use --export /path/to/export (repeat for channel and discussion group). Add --apply to upload.');
const report = { dryRun: !values.apply, planned: 0, uploaded: 0, alreadyLinked: 0, issues: [] };
try {
  const chats = (await Promise.all(values.export.map(readTelegramExport))).flat();
  await mongoose.connect(process.env.MONGODB_URL, { serverSelectionTimeoutMS: 15000 });
  const products = await Sneacker.find({}).select('barcode telegramPhotos').lean();
  const plan = planTelegramPhotos(chats, indexProducts(products));
  report.planned = plan.photos.length;
  report.issues.push(...plan.issues);
  const groups = new Map();
  for (const photo of plan.photos) groups.set(photo.productId, [...(groups.get(photo.productId) || []), photo]);
  const storage = values.apply ? createR2Storage() : null;
  if (storage) await storage.check();
  const pending = groups.entries();
  let stopped = false;
  let completed = 0;
  async function importGroup(productId, photos) {
    const previous = products.find(p => String(p._id) === productId);
    const known = new Map((previous.telegramPhotos || []).map(p => [p.sha256, p]));
    const gallery = [];
    let valid = true;
    for (const photo of photos) {
      try {
        const file = await safePhotoPath(photo.root, photo.file);
        const sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
        if (gallery.some(p => p.sha256 === sha256)) { report.alreadyLinked++; continue; }
        let asset = known.get(sha256);
        if (asset) report.alreadyLinked++;
        else if (values.apply) { asset = await storage.uploadPhoto(file, photo.article, sha256); report.uploaded++; }
        gallery.push({ url: asset?.url, publicId: asset?.publicId, sha256,
          sourceChatId: photo.chatId, sourceMessageId: photo.messageId, sourceThreadId: photo.threadId });
      } catch (error) {
        valid = false;
        report.issues.push({ article: photo.article, chatId: photo.chatId, messageId: photo.messageId,
          reason: error.http_code ? `storage-http-${error.http_code}` : 'photo-read-or-upload-failed' });
        if ([401, 403, 420, 429].includes(error.http_code)) throw new Error('Photo storage rejected access or reached a limit.');
      }
    }
    // Replace only when the whole selection succeeds; reruns never append beyond ten.
    const galleryFields = ['url', 'publicId', 'sha256', 'sourceChatId', 'sourceMessageId', 'sourceThreadId'];
    const sameGallery = previous.telegramPhotos?.length === gallery.length && gallery.every((photo, i) =>
      galleryFields.every(field => photo[field] === previous.telegramPhotos[i][field]));
    if (values.apply && valid && !sameGallery) await Sneacker.updateOne({ _id: productId }, { $set: { telegramPhotos: gallery } });
    if (!valid) process.exitCode = 1;
    completed++;
    if (completed % 20 === 0) console.log(JSON.stringify({ completed, total: groups.size, uploaded: report.uploaded, issues: report.issues.length }));
  }
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (!stopped) {
      const next = pending.next();
      if (next.done) return;
      try { await importGroup(...next.value); }
      catch { stopped = true; report.failed = true; process.exitCode = 1; }
    }
  }));

} catch (error) {
  report.failed = true;
  console.error('Photo import failed. Check export paths, connection and credentials.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
  await writeFile(values.report, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ planned: report.planned, uploaded: report.uploaded, alreadyLinked: report.alreadyLinked, issues: report.issues.length, dryRun: report.dryRun }));
}
