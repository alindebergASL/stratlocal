import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createGateway } from "../deploy/local/web-gateway.mjs";

test("fixed gateway preserves login cookies, request origin and uploaded bytes", async () => {
  const app=http.createServer(async (req,res)=>{
    if(req.url==="/download") { res.end("s".repeat(2_000_000)); return; }
    const chunks=[];for await(const c of req)chunks.push(c);
    res.setHeader("set-cookie","session=synthetic; HttpOnly; SameSite=Lax");
    res.end(JSON.stringify({url:req.url,host:req.headers.host,origin:req.headers.origin,body:Buffer.concat(chunks).toString()}));
  });
  app.listen(0,"127.0.0.1");await once(app,"listening");
  const gateway=createGateway({host:"127.0.0.1",port:app.address().port});gateway.listen(0,"127.0.0.1");await once(gateway,"listening");
  try {
    const port=gateway.address().port;
    const body="Synthetic import payload\n".repeat(4000);
    const result=await fetch(`http://127.0.0.1:${port}/api/local/import`,{method:"POST",headers:{origin:`http://127.0.0.1:${port}`,connection:"close"},body});
    assert.match(result.headers.get("set-cookie"),/session=synthetic/);
    assert.deepEqual(await result.json(),{url:"/api/local/import",host:`127.0.0.1:${port}`,origin:`http://127.0.0.1:${port}`,body});
    const download=await fetch(`http://127.0.0.1:${port}/download`,{headers:{connection:"close"}});
    let received=0;
    for await(const chunk of download.body){received+=chunk.length;await new Promise(resolve=>setTimeout(resolve,1));}
    assert.equal(received,2_000_000);
  } finally { gateway.close();app.closeAllConnections();app.close(); }
});

test("unavailable app closes a connection without crashing the gateway", async()=>{
  const app=http.createServer();app.listen(0,"127.0.0.1");await once(app,"listening");const port=app.address().port;await new Promise(r=>app.close(r));
  const gateway=createGateway({host:"127.0.0.1",port});gateway.listen(0,"127.0.0.1");await once(gateway,"listening");
  try { await assert.rejects(fetch(`http://127.0.0.1:${gateway.address().port}/`,{signal:AbortSignal.timeout(3000)}));assert.equal(gateway.listening,true); }
  finally{gateway.close();}
});
