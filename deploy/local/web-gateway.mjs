import net from "node:net";
import { pathToFileURL } from "node:url";

// Fixed-destination TCP forwarding preserves HTTP Host, Origin, cookies and
// streaming bodies. The client cannot select an upstream host or port.
export function createGateway({ host = "app", port = 3000 } = {}) {
  const server = net.createServer(client => {
    const upstream = net.createConnection({ host, port });
    const close = () => { client.destroy(); upstream.destroy(); };
    client.setTimeout(300_000, close);
    upstream.setTimeout(300_000, close);
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", () => upstream.destroy());
    // A normal upstream EOF must drain buffered download bytes to the browser.
    upstream.on("close", () => { if (!upstream.readableEnded) client.destroy(); });
    client.pipe(upstream);
    upstream.pipe(client);
  });
  server.maxConnections = 256;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGateway();
  server.listen(3000, "0.0.0.0", () => console.log("Local browser gateway ready"));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
