import fs from "node:fs";
if (process.env.STRATEGY_LOCAL_ONLY !== "1") throw new Error("Local image requires local-only mode");
process.umask(0o077);
const password = fs.readFileSync("/run/secrets/bootstrap_password", "utf8").trimEnd();
if (password.length < 12) throw new Error("Choose a bootstrap password of at least 12 characters");
process.env.USER1_PASSWORD = password;
await import("./server.js");
