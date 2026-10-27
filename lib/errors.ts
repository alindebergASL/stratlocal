// What went wrong, in a sentence a person can act on.
//
// Two people run this app themselves. There is no untrusted user to withhold
// internals from, and "Something went wrong" costs a debugging session every
// time it appears — so the rule here is the opposite of the usual one: say the
// real thing, and put the useful part first.

import { ZodError } from "zod";
import { ApplyError } from "./proposals/apply";
import { BudgetError } from "./ai/guard";

// A zod path like ["attendees", 2, "name"] reads better as "attendees[2].name".
function pathText(path: PropertyKey[]): string {
  return path.reduce<string>((s, p) => (typeof p === "number" ? `${s}[${p}]` : s ? `${s}.${String(p)}` : String(p)), "");
}

function describeZod(e: ZodError): string {
  // One field is the common case and deserves a sentence; several get a list.
  const issues = e.issues.slice(0, 4).map((i) => {
    const where = pathText(i.path);
    return where ? `${where}: ${i.message}` : i.message;
  });
  const more = e.issues.length > issues.length ? ` (and ${e.issues.length - issues.length} more)` : "";
  return `${issues.join("; ")}${more}`;
}

// better-sqlite3 puts the useful part in `code` and a readable-but-terse
// sentence in `message`. The codes below are the ones this app can actually
// produce; anything else falls through to the raw message.
function describeSqlite(code: string, message: string): string | null {
  if (code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT") {
    return "The database was busy — someone else was saving at the same moment. Try that again.";
  }
  if (code.startsWith("SQLITE_CONSTRAINT_UNIQUE") || code.startsWith("SQLITE_CONSTRAINT_PRIMARYKEY")) {
    return `That already exists: ${message}`;
  }
  if (code.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY")) {
    return "That points at a record which no longer exists.";
  }
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    return `The database refused it: ${message}`;
  }
  if (code === "SQLITE_FULL" || code === "SQLITE_IOERR") {
    return `The database could not be written to (${code}). Check disk space on the server.`;
  }
  if (code === "SQLITE_READONLY") {
    return "The database is read-only. Check the data volume's permissions.";
  }
  return null;
}

export function describeError(e: unknown): string {
  // These three already carry a sentence written for this situation.
  if (e instanceof ApplyError || e instanceof BudgetError) return e.message;
  if (e instanceof ZodError) return describeZod(e);

  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") {
      const sqlite = describeSqlite(code, e.message);
      if (sqlite) return sqlite;
      // Not one we know: the code is still more useful than hiding it.
      if (code.startsWith("SQLITE_")) return `${e.message} (${code})`;
    }
    return e.message || e.name;
  }

  if (typeof e === "string" && e.trim()) return e;
  return "Something went wrong, and it did not say what.";
}
