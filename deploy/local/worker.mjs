import {openQueue} from './jobs.mjs';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
const queue=openQueue('/app/data/jobs.sqlite'),owner=randomUUID();
let stopping=false;
process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
while(!stopping) {
 const job=queue.claim(owner);
 if(!job) {await new Promise(r=>setTimeout(r,1000));continue;}
 try {
   // Only a bounded local maintenance handler is enabled in this foundation.
   // Import/model handlers must be added explicitly, with heartbeat/cancellation.
   if(job.kind!=='integrity_check') throw new Error('Unsupported job kind');
   const db=new Database('/app/data/strategy.sqlite',{readonly:true,fileMustExist:true});
   try {queue.finish(job.id,owner,{integrity:db.pragma('quick_check',{simple:true})});} finally{db.close();}
 } catch(e) {try{queue.finish(job.id,owner,null,String(e));}catch{ /* expired worker cannot overwrite another claim */ }}
}
queue.close();
