import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const root=process.cwd(),data=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-smoke-'));
const log=fs.openSync('/tmp/strategylocal-server.log','w');
const child=spawn(process.execPath,['.next/standalone/server.js'],{cwd:root,env:{...process.env,STRATEGY_LOCAL_ONLY:'1',NODE_ENV:'production',PORT:'3017',HOSTNAME:'127.0.0.1',DB_PATH:path.join(data,'strategy.sqlite'),USER1_EMAIL:'synthetic@example.invalid',USER1_PASSWORD:'Synthetic-test-only-123'},stdio:['ignore',log,log]});
try {
 let r;
 for(let i=0;i<60;i++){try{r=await fetch('http://127.0.0.1:3017/login');if(r.ok)break;}catch{} await new Promise(r=>setTimeout(r,500));}
 assert.equal(r?.status,200);assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);
 r=await fetch('http://127.0.0.1:3017/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'synthetic@example.invalid',password:'Synthetic-test-only-123'})});
 assert.equal(r.status,200,await r.clone().text());const cookie=r.headers.get('set-cookie');assert.ok(cookie);assert.equal(/; Secure/i.test(cookie),false);
 const home=await fetch('http://127.0.0.1:3017/',{headers:{cookie:cookie.split(';')[0]},redirect:'manual'});assert.equal(home.status,200);
 console.log('PASS: production login, bootstrap user, local cookie and authenticated home; CSP present');
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));fs.closeSync(log);fs.rmSync(data,{recursive:true,force:true});}
