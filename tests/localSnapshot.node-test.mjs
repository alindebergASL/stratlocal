import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
const script=new URL('../deploy/local/snapshot.mjs',import.meta.url);
test('backup restores DB and original bytes, rejects tampering and existing destinations',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-snapshot-'));
 try {
 const source=path.join(root,'source');fs.mkdirSync(path.join(source,'docs'),{recursive:true});
 const d=new Database(path.join(source,'strategy.sqlite'));
 d.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY, name TEXT); INSERT INTO accounts VALUES('a','Synthetic account')");d.close();
 fs.writeFileSync(path.join(source,'docs','sample.json'),'{"synthetic":true}');
 const run=(...args)=>spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
 const backup=path.join(root,'backup'),restored=path.join(root,'restored');
 let r=run('backup',source,backup);assert.equal(r.status,0,r.stderr);
 r=run('restore',backup,restored);assert.equal(r.status,0,r.stderr);
 assert.equal(fs.readFileSync(path.join(restored,'docs','sample.json'),'utf8'),'{"synthetic":true}');
 const db=new Database(path.join(restored,'strategy.sqlite'));assert.equal(db.prepare('SELECT name FROM accounts').get().name,'Synthetic account');db.close();
 assert.notEqual(run('restore',backup,restored).status,0);
 fs.writeFileSync(path.join(backup,'docs','sample.json'),'tampered');
 assert.notEqual(run('restore',backup,path.join(root,'bad')).status,0);
 assert.equal(fs.existsSync(path.join(root,'bad')),false);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
