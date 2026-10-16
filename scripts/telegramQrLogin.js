import 'dotenv/config';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { makeTelegramClient, sessionFile } from '../src/services/telegram/client.js';
const port=3106;const origin=`http://127.0.0.1:${port}`;const csrf=randomBytes(24).toString('hex');
let state={step:'connecting',qr:null,error:null};let passwordResolve;let client;
const abort=new AbortController();
const page=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Подключение Telegram — Krossava</title><style>body{font:18px system-ui;max-width:560px;margin:50px auto;padding:24px;background:#f5f6fa;color:#17212b}main{background:white;padding:32px;border-radius:20px}img{width:280px;max-width:100%}input,button{padding:12px;font:inherit;margin:8px 0;width:100%;box-sizing:border-box}button{background:#229ed9;color:white;border:0;border-radius:8px}p{line-height:1.5}</style><main><h1>Подключить Telegram</h1><p>Для загрузки фотографий из комментариев поставщика.</p><p id="status">Соединение…</p><img id="qr" hidden alt="QR-код входа в Telegram"><form id="form" hidden><label>Пароль двухэтапной проверки Telegram<input id="password" type="password" autocomplete="current-password" required></label><button>Подтвердить вход</button></form><p id="error"></p><small>Код и пароль не нужно отправлять в чат. Авторизованная сессия сохраняется на этом компьютере.</small></main><script>
const status=document.getElementById('status'),qr=document.getElementById('qr'),form=document.getElementById('form'),error=document.getElementById('error');
async function poll(){try{const s=await(await fetch('/status')).json();status.textContent={connecting:'Соединение…',qr:'На телефоне: Telegram → Настройки → Устройства → Подключить устройство. Отсканируйте QR-код и подтвердите вход.',password:'Введите пароль двухэтапной проверки.',done:'Telegram подключён. Можно вернуться в чат.',failed:'Подключение остановлено. Вернитесь в чат.'}[s.step];qr.hidden=s.step!=='qr';if(s.qr)qr.src=s.qr;form.hidden=s.step!=='password';error.textContent=s.error||'';}catch{status.textContent='Соединение со страницей входа потеряно.';}}
form.onsubmit=async e=>{e.preventDefault();const input=document.getElementById('password');const password=input.value;input.value='';await fetch('/password',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF':'${csrf}'},body:JSON.stringify({password})});};poll();setInterval(poll,1500);
</script></html>`;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
 if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
 if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);return;}
 if(req.method==='GET'&&req.url==='/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));return;}
 if(req.method==='POST'&&req.url==='/password'){
  if(req.headers.origin!==origin||req.headers['x-csrf']!==csrf||!passwordResolve){res.writeHead(403).end();return;}
  let body='';try{for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413).end();return;}}const {password}=JSON.parse(body);if(typeof password!=='string'||!password){res.writeHead(400).end();return;}const resolve=passwordResolve;passwordResolve=null;state.step='connecting';resolve(password);res.end('OK');}catch{res.writeHead(400).end();}return;
 }
 res.writeHead(404).end();
});
server.listen(port,'127.0.0.1',()=>console.log(`LOGIN_PAGE ${origin}`));
const timer=setTimeout(()=>abort.abort(),10*60*1000);
try{
 client=await makeTelegramClient();await client.connect();
 if(!await client.checkAuthorization())await client.signInUserWithQrCode({apiId:Number(process.env.TELEGRAM_API_ID),apiHash:process.env.TELEGRAM_API_HASH},{
  abortSignal:abort.signal,
  qrCode:async({token})=>{state={step:'qr',qr:await QRCode.toDataURL(`tg://login?token=${token.toString('base64url')}`),error:null};console.log('QR_READY');},
  password:async()=>{state={step:'password',qr:null,error:null};return new Promise(resolve=>{passwordResolve=resolve;});},
  onError:async()=>{state.error='Не удалось войти. Проверьте данные и повторите.';return true;},
 });
 if(!await client.checkAuthorization())throw new Error('Not authorized');
 await mkdir(path.dirname(sessionFile),{recursive:true,mode:0o700});await writeFile(sessionFile,client.session.save(),{mode:0o600});await chmod(sessionFile,0o600);
 state={step:'done',qr:null,error:null};console.log('TELEGRAM_AUTHORIZED');
}catch(error){state={step:'failed',qr:null,error:error.errorMessage||'Не удалось подключить Telegram.'};console.log('TELEGRAM_LOGIN_FAILED',error.errorMessage||error.name);}
finally{clearTimeout(timer);if(client)await client.disconnect();setTimeout(()=>server.close(),60000).unref();}
