if (!process.env.DB_PATH?.includes("strategy-e2e-")) throw Error("Disposable e2e DB required");
console.log = (...args: unknown[]) => console.error(...args);
const { db } = await import("../lib/db");
const { glanceFixture } = await import("../tests/glanceFixtures");
const user = db().prepare("SELECT id FROM users WHERE email=?").get(process.env.E2E_USER1_EMAIL) as { id: string } | undefined;
if (!user) throw Error("Synthetic runner user required");
process.stdout.write(JSON.stringify(glanceFixture(user.id)));
