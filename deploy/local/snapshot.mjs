// Run only with the app stopped; the wrapper enforces that for this deployment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
const [mode, source, destination] = process.argv.slice(2);
if (!['backup','restore'].includes(mode) || !source || !destination) throw new Error('Usage: snapshot.mjs backup|restore SOURCE DESTINATION');
if (fs.existsSync(destination)) throw new Error('Destination must not exist');
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(dir, prefix='') {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => {
    const rel = path.join(prefix,e.name);
    if(e.isSymbolicLink()) throw new Error('Symlinks are not allowed');
    return e.isDirectory()?files(path.join(dir,e.name),rel):[rel];
  });
}
const check = p => {
 const d = new Database(p,{readonly:true,fileMustExist:true});
 try { if(d.pragma('integrity_check',{simple:true})!=='ok') throw new Error('SQLite integrity check failed'); }
 finally { d.close(); }
};
const temp = `${destination}.partial-${crypto.randomUUID()}`;
try {
 fs.mkdirSync(temp,{recursive:true,mode:0o700});
 if(mode==='backup') {
   const d = new Database(path.join(source,'strategy.sqlite'),{readonly:true,fileMustExist:true});
   try { await d.backup(path.join(temp,'strategy.sqlite')); } finally { d.close(); }
   if(fs.existsSync(path.join(source,'jobs.sqlite'))) {
     const q=new Database(path.join(source,'jobs.sqlite'),{readonly:true,fileMustExist:true});
     try {await q.backup(path.join(temp,'jobs.sqlite'));} finally {q.close();}
   }
   if(fs.existsSync(path.join(source,'docs'))) fs.cpSync(path.join(source,'docs'),path.join(temp,'docs'),{recursive:true,dereference:false});
   const hashes = Object.fromEntries(files(temp).map(p=>[p,digest(path.join(temp,p))]));
   fs.writeFileSync(path.join(temp,'snapshot.json'),JSON.stringify({version:1,created_at:new Date().toISOString(),files:hashes},null,2));
 } else {
   files(source); // Reject symlinks in any ancestor within the snapshot.
   const m=JSON.parse(fs.readFileSync(path.join(source,'snapshot.json'),'utf8'));
   if(m.version!==1 || !m.files?.['strategy.sqlite']) throw new Error('Invalid snapshot manifest');
   for(const [p,hash] of Object.entries(m.files)) {
     if(path.isAbsolute(p)||p.split(/[\\/]/).some(s=>s==='..')||!(p==='strategy.sqlite'||p==='jobs.sqlite'||p.startsWith('docs/'))) throw new Error('Unsafe snapshot path');
     const full=path.join(source,p);
     if(fs.lstatSync(full).isSymbolicLink()||digest(full)!==hash) throw new Error(`Snapshot mismatch: ${p}`);
     fs.mkdirSync(path.dirname(path.join(temp,p)),{recursive:true});
     fs.copyFileSync(full,path.join(temp,p));
   }
 }
 check(path.join(temp,'strategy.sqlite'));
 if(fs.existsSync(path.join(temp,'jobs.sqlite'))) check(path.join(temp,'jobs.sqlite'));
 fs.renameSync(temp,destination);
 console.log(JSON.stringify({status:'ok',mode,destination}));
} catch(e) { fs.rmSync(temp,{recursive:true,force:true});throw e; }
