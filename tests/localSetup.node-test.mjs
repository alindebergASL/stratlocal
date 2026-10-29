import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
for(const [name,running,fail,expected] of [
  ['resumes only the app if the worker was stopped','app\nmodel-gateway',false,'start app'],
  ['resumes both services after snapshot failure','app\nworker',true,'start app worker'],
  ['leaves an initially stopped installation stopped','',false,null],
])test(name,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-setup-test-'));
  try{
    fs.mkdirSync(path.join(dir,'deploy/local'),{recursive:true});fs.mkdirSync(path.join(dir,'bin'));
    fs.copyFileSync(path.join(root,'deploy/local/backup.sh'),path.join(dir,'deploy/local/backup.sh'));
    fs.writeFileSync(path.join(dir,'bin/docker'),`#!/bin/sh\nprintf '%s\\n' "$*" >> "$TEST_LOG"\ncase "$*" in\n *" ps "*) printf '%s\\n' "$TEST_RUNNING" ;;\n *" run "*) exit "$TEST_FAIL" ;;\nesac\n`,{mode:0o755});
    const log=path.join(dir,'calls');
    const result=spawnSync('sh',[path.join(dir,'deploy/local/backup.sh')],{cwd:'/',encoding:'utf8',env:{...process.env,PATH:`${dir}/bin:${process.env.PATH}`,TEST_LOG:log,TEST_RUNNING:running,TEST_FAIL:fail?'1':'0'}});
    assert.equal(result.status,fail?1:0,result.stderr);
    const lines=fs.readFileSync(log,'utf8').trim().split('\n');
    assert.ok(lines.every(l=>l.startsWith('compose -p strategylocal -f compose.yaml --env-file .env ')));
    assert.ok(lines.some(l=>l.endsWith('stop app worker')));
    const starts=lines.filter(l=>l.includes(' start '));
    assert.deepEqual(starts,expected?[`compose -p strategylocal -f compose.yaml --env-file .env ${expected}`]:[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
