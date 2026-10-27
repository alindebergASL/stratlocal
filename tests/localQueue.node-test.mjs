import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openQueue} from '../deploy/local/jobs.mjs';
test('durable queue deduplicates, serializes workers and fences expired claims',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-queue-'));
 const file=path.join(dir,'jobs.sqlite');let q=openQueue(file),other;
 try {
 const id=q.enqueue('request-1','integrity_check');
 assert.equal(q.enqueue('request-1','integrity_check'),id);
 assert.throws(()=>q.enqueue('request-1','other'),/different content/);
 q.close();q=openQueue(file);other=openQueue(file);
 assert.equal(q.get(id).status,'queued');
 const now=Date.now();assert.equal(q.claim('old',now,1000).id,id);
 assert.equal(other.claim('second',now),null);
 assert.equal(other.claim('new',now+1001).id,id);
 assert.throws(()=>q.finish(id,'old',{}),/lease lost/);
 other.finish(id,'new',{ok:true});assert.equal(q.get(id).status,'done');
 assert.equal(q.claim('last'),null);
 } finally{q.close();other?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
