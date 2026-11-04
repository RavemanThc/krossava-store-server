import 'dotenv/config';
import { r2Variables, r2Config } from '../src/services/import/r2.js';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { parseArgs } from 'node:util';
const { values }=parseArgs({options:{apply:{type:'boolean',default:false}}});
async function run(script,args=[]){
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,...args],{stdio:'inherit'});
    child.once('error',()=>reject(new Error('Unable to start sync step.')));
    child.once('exit',code=>code===0?resolve():reject(new Error(`Sync step failed: ${script}`)));
  });
}
let directory;
try{
  // Validate all configuration before any catalogue changes.
  for(const name of ['EASYDROP_FEED_URL','MONGODB_URL','ALGOLIA_APP_ID','ALGOLIA_ADMIN_KEY',...r2Variables,'TELEGRAM_API_ID','TELEGRAM_API_HASH']){
    if(!process.env[name])throw new Error(`Missing ${name}`);
  }
  r2Config();
  if(values.apply && !process.env.TELEGRAM_SESSION){
    try{await readFile('.telegram/session.txt');}catch{throw new Error('Missing TELEGRAM_SESSION');}
  }
  await run('scripts/importProducts.js',values.apply?['--apply']:[]);
  if(values.apply){
    await mkdir('.telegram',{recursive:true,mode:0o700});
    directory=await mkdtemp('.telegram/daily-');
    await run('scripts/collectTelegramComments.js',['--missing-only','--output',directory]);
    const report=JSON.parse(await readFile(`${directory}/collection-report.json`,'utf8'));
    await writeFile('sync-reports/telegram.json',JSON.stringify(report,null,2));
    if(report.products>0)await run('scripts/importTelegramPhotos.js',['--export',directory,'--apply','--report','sync-reports/photos.json']);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(directory)await rm(directory,{recursive:true,force:true});}
