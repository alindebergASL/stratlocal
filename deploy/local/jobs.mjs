import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
// Separate queue DB avoids running the application's startup migrations in a worker.
export function openQueue(filename) {
 const db=new Database(filename);db.pragma('journal_mode = WAL');db.pragma('busy_timeout = 5000');
 db.exec(`CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, owner TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT, created_at INTEGER NOT NULL)`);
 return {
  close:()=>db.close(),
  enqueue(requestId,kind,payload={}) {
   const encoded=JSON.stringify(payload);
   return db.transaction(()=>{
    const existing=db.prepare('SELECT * FROM jobs WHERE request_id=?').get(requestId);
    if(existing) {
      if(existing.kind!==kind||existing.payload!==encoded) throw new Error('Request ID already used with different content');
      return existing.id;
    }
    const id=randomUUID();db.prepare("INSERT INTO jobs(id,request_id,kind,payload,status,created_at) VALUES(?,?,?,?,'queued',?)").run(id,requestId,kind,encoded,Date.now());return id;
   }).immediate();
  },
  claim(owner,now=Date.now(),leaseMs=60000) {
   return db.transaction(()=>{
    // Single global slot; expired claims can be recovered after a process dies.
    if(db.prepare("SELECT id FROM jobs WHERE status='running' AND lease_until>?").get(now)) return null;
    const row=db.prepare("SELECT * FROM jobs WHERE status='queued' OR (status='running' AND lease_until<=?) ORDER BY created_at,id LIMIT 1").get(now);
    if(!row) return null;
    db.prepare("UPDATE jobs SET status='running',owner=?,lease_until=?,attempts=attempts+1 WHERE id=?").run(owner,now+leaseMs,row.id);
    return {...row,owner,payload:JSON.parse(row.payload)};
   }).immediate();
  },
  finish(id,owner,result,error=null) {
   const r=db.prepare("UPDATE jobs SET status=?,result=?,error=?,lease_until=NULL WHERE id=? AND owner=? AND status='running' AND lease_until>?").run(error?'failed':'done',JSON.stringify(result),error,id,owner,Date.now());
   if(r.changes!==1) throw new Error('Job lease lost');
  },
  get:id=>db.prepare('SELECT * FROM jobs WHERE id=?').get(id),
 };
}
