import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { checkProviders } from "@/lib/ai/smoke";

export const runtime = "nodejs";

// The provider check, reachable from the running app.
//
// `npm run smoke:providers` runs through tsx, which is a devDependency and is
// not in the deployment image — so the first thing deploy/README.md told you
// to do after deploying was a command that could not run there. This is the
// same function, from the same code path the app's real calls use, behind the
// same login. It works from a phone, which is where you are when a button has
// stopped working.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireUser(req);
    return json({ checks: await checkProviders(user.id) });
  });
}
