import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const r2Variables = ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_R2_BUCKET_NAME','CLOUDFLARE_R2_ACCESS_KEY_ID','CLOUDFLARE_R2_SECRET_ACCESS_KEY','CLOUDFLARE_R2_PUBLIC_URL'];
export const assetKeyPattern = /^krossava\/telegram\/(?:[A-Z]|M[AB])\d{4}\/[a-f0-9]{64}$/;
export function r2Config(env = process.env) {
  for (const key of r2Variables) if (!env[key]?.trim()) throw new Error(`Missing ${key}`);
  const account = env.CLOUDFLARE_ACCOUNT_ID.trim();
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('Invalid R2 account ID');
  const delivery = env.CLOUDFLARE_R2_PUBLIC_URL.trim();
  const base = new URL(delivery.includes('://') ? delivery : `https://${delivery}`);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('R2 requires a public HTTPS delivery URL, not the S3 endpoint');
  return { bucket: env.CLOUDFLARE_R2_BUCKET_NAME.trim(), publicUrl: base.href.replace(/\/$/, ''), endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY.trim() } };
}
export function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  throw new Error('Unsupported photo format');
}
export function createR2Storage(config = r2Config(), suppliedClient) {
  const client = suppliedClient || new S3Client({region:'auto', endpoint:config.endpoint, credentials:config.credentials, maxAttempts:3, requestHandler:{httpsAgent:new https.Agent({family:4,keepAlive:true,maxSockets:48}),connectionTimeout:10000,requestTimeout:15000,throwOnRequestTimeout:true}, requestChecksumCalculation:'WHEN_REQUIRED', responseChecksumValidation:'WHEN_REQUIRED'});
  const send = async command => {
    try { return await client.send(command, {abortSignal:AbortSignal.timeout(60000)}); }
    catch (error) { const safe = new Error('R2 operation failed'); safe.http_code = error.$metadata?.httpStatusCode; safe.operation=command.constructor.name; safe.reason=['TimeoutError','AbortError'].includes(error.name) ? error.name : 'request-failed'; throw safe; }
  };
  const url = key => `${config.publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return {
    async check() { await send(new ListObjectsV2Command({Bucket:config.bucket,Prefix:'krossava/telegram/',MaxKeys:1})); },
    async uploadBytes(bytes, article, sha256, existingIds) {
      const key = `krossava/telegram/${article}/${sha256}`;
      if (!assetKeyPattern.test(key)) throw new Error('Invalid gallery asset key');
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Invalid photo size');
      const contentType = imageType(bytes);
      let exists = existingIds?.has(`r2:${key}`) || false;
      if(!existingIds) { try { await send(new HeadObjectCommand({Bucket:config.bucket,Key:key})); exists=true; }
      catch(error) { if(error.http_code !== 404) throw error; } }
      if (!exists) await send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:bytes,ContentType:contentType,CacheControl:'public, max-age=31536000, immutable'}));
      return {url:url(key),publicId:`r2:${key}`};
    },
    async uploadPhoto(file,article,sha256) { return this.uploadBytes(await readFile(file),article,sha256); },
    async listAssets(prefix) {
      if (prefix !== 'krossava/telegram/' && !/^krossava\/telegram\/(?:[A-Z]|M[AB])\d{4}\/$/.test(prefix)) throw new Error('Invalid gallery prefix');
      const ids=[]; let cursor;
      do {
        const page=await send(new ListObjectsV2Command({Bucket:config.bucket,Prefix:prefix,ContinuationToken:cursor}));
        for(const object of page.Contents || []) if(assetKeyPattern.test(object.Key)) ids.push(`r2:${object.Key}`);
        cursor=page.IsTruncated ? page.NextContinuationToken : undefined;
        if(page.IsTruncated && !cursor) throw new Error('Incomplete R2 listing');
      } while(cursor);
      return ids;
    },
    async destroy(id) {
      if(!id.startsWith('r2:') || !assetKeyPattern.test(id.slice(3))) throw new Error('Invalid R2 asset ID');
      await send(new DeleteObjectCommand({Bucket:config.bucket,Key:id.slice(3)}));
      return {result:'ok'};
    },
  };
}


// IPv4 avoids intermittent IPv6 connection failures on local migration hosts.
export async function verifyPublicImage(url) {
  for(let attempt=0;attempt<3;attempt++) {
    try {
      await new Promise((resolve,reject)=>{
        const request=https.request(url,{method:'HEAD',family:4,signal:AbortSignal.timeout(30000)},response=>{
          response.resume();
          if(response.statusCode===200 && response.headers['content-type']?.startsWith('image/')) resolve();
          else {const error=new Error('R2 public delivery failed');error.http_code=response.statusCode;reject(error);}
        });
        request.on('error',()=>reject(new Error('R2 public delivery connection failed')));
        request.end();
      });
      return;
    } catch(error) {
      if(attempt===2) throw error;
      await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    }
  }
}
