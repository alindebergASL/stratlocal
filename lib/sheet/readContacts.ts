// Cells + a confirmed mapping -> people, and a list of what could not be read.
//
// The sibling of readDeals.ts, and deliberately the same two rules, because
// they are the same file in the same screen and a rule that held for one kind
// and not the other would be a difference nobody could predict:
//
//   - a blank cell is not evidence of anything, so it stays undefined and can
//     never clear a title someone typed;
//   - a cell that is present and unreadable stops its row by number and says
//     why, rather than being dropped from it (DECISIONS #27).
//
// What is different is the key. A deal row is matched on a CRM id and nothing
// else; a person has no such id, so the match is email first and then an exact
// name — the rule lib/matchContact.ts already applies to the people
// named on an imported report.
import { FieldError } from "../money";
import { nameKey } from "../format";
import { ORG_WORDS, ROLE_WORDS, type SheetMapping } from "./columns";
import { contactEmail, ContactRole, FIELD_MAX } from "../proposals/schema";
import type { ContactOrg } from "../db";
import type { RowProblem } from "./readDeals";

export type SheetContact = {
  /** 1-based, counting the header as row 1, so it matches what the spreadsheet shows. */
  row: number;
  name: string;
  email?: string | null;
  title?: string | null;
  /** Undefined when the column is blank or unmapped. The default lives in the
   *  diff, where it applies to a create and not to an update — a blank cell
   *  must not move an existing person from one side of the table to the other. */
  org?: ContactOrg;
  role?: string | null;
  notes?: string | null;
};

export type ReadContactResult = { contacts: SheetContact[]; skipped: RowProblem[] };

function capped(raw: string, max: number, label: string): string {
  if (raw.length > max) {
    throw new FieldError(`${label} is ${raw.length} characters and the most this field holds is ${max}. Shorten it in the spreadsheet and import again.`);
  }
  return raw;
}

// createProposalBatch parses every draft in one transaction with no per-draft
// try, so an address the schema refuses three hundred rows in would roll the
// whole import back with a Zod path for a message. The row has to stop here
// instead, by number.
//
// This runs `contactEmail`, the schema's own rule, rather than a description
// of it. The first version of this function was a description — "one @,
// something either side, a dot in the domain" — under a comment asserting
// that nothing looser could reach the schema. It was looser: a domain label
// starting with a hyphen, a doubled dot, a leading or trailing dot on either
// side, an underscore in the domain, a single-letter suffix, and four more
// shapes passed it and are refused by ContactPatch — which is the exact
// import-killing cell this function exists to catch. A check written twice is
// a check that disagrees with itself, which is the same argument
// lib/matchContact.ts makes about matching.
function readEmail(raw: string): string {
  const parsed = contactEmail.safeParse(raw);
  if (!parsed.success) {
    const s = raw.trim();
    if (s.length > 200) throw new FieldError(`the email address is ${s.length} characters and the most this field holds is 200.`);
    throw new FieldError(`could not read “${s}” as an email address.`);
  }
  return parsed.data;
}

function readOrg(raw: string): ContactOrg {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const found = ORG_WORDS[key];
  if (!found) throw new FieldError(`could not read “${raw.trim()}” as customer, vendor or partner.`);
  return found;
}

function readRole(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const found = ROLE_WORDS[key] ?? ROLE_WORDS[key.replace(/ /g, "_")];
  // A role the app has no word for is not a reason to lose the person, and
  // guessing one would put a label on them that nobody typed. `other` is what
  // the stored vocabulary has for exactly this, and the title column — which a
  // people export nearly always carries — keeps what they actually are.
  if (!found) return "other";
  // Belt and braces: the table above is hand-written and the enum is the thing
  // the write path will check against.
  return ContactRole.safeParse(found).success ? found : "other";
}

export function readContacts(body: string[][], mapping: SheetMapping): ReadContactResult {
  const contacts: SheetContact[] = [];
  const skipped: RowProblem[] = [];
  const at = (cells: string[], field: keyof SheetMapping): string => {
    const i = mapping[field];
    if (i === null || i === undefined) return "";
    return (cells[i] ?? "").trim();
  };
  // One person twice in one file would be two proposals editing the same row,
  // and accepting both is a conflict the second one loses — or, with no match
  // to find yet, two new people with one name.
  //
  // An address is an identifier and a name is not, and the first version of
  // this treated them as the same kind of key: a repeated name was refused
  // even when both rows carried their own, different address. Two people do
  // share a name, and when each has said which one they are there is nothing
  // to guess — so only the email key refuses outright, and the name key
  // refuses the case it was actually written for, which is the one nothing can
  // tell apart: a name that arrives twice with an address missing on either
  // side of the pair. The map remembers which, because the ambiguity is the
  // same whichever row order the file happens to be in.
  const seenEmails = new Set<string>();
  const seenNames = new Map<string, boolean>();

  body.forEach((cells, index) => {
    const row = index + 2; // header is row 1
    try {
      const name = at(cells, "name");
      if (name === "") {
        skipped.push({ row, why: "no name" });
        return;
      }
      capped(name, FIELD_MAX.short, "the name");

      const person: SheetContact = { row, name };

      const email = at(cells, "email");
      if (email !== "") person.email = readEmail(email);

      const emailKey = person.email?.toLowerCase();
      // Keep distinct symbol-only labels distinct when there is no letter key.
      const key = nameKey(name) || name.toLowerCase().replace(/\s+/g, " ").trim();
      if (emailKey && seenEmails.has(emailKey)) {
        skipped.push({ row, why: `${person.email} is on an earlier row too` });
        return;
      }
      const earlierLackedEmail = seenNames.get(key);
      if (earlierLackedEmail !== undefined && (!emailKey || earlierLackedEmail)) {
        skipped.push({
          row,
          why: emailKey
            ? `${name} is on an earlier row too, and that row has no address, so there is no way to tell whether these are two people or one. If they are two, give the earlier row its own address.`
            : `${name} is on an earlier row too, and this row has no address to tell them apart. If these are two different people, give them different names or an address each.`,
        });
        return;
      }

      const cell = (field: keyof SheetMapping, max: number, label: string) => {
        const v = at(cells, field);
        return v === "" ? undefined : capped(v, max, label);
      };
      person.title = cell("title", FIELD_MAX.short, "the job title");
      person.notes = cell("notes", FIELD_MAX.text, "the notes");

      const org = at(cells, "org");
      if (org !== "") person.org = readOrg(org);
      const role = at(cells, "role");
      if (role !== "") person.role = readRole(role);

      // Claimed only once the whole row was readable. A row that stops on an
      // unreadable title would otherwise hold this person's name and address
      // against the file's next, good row for them — a second skip, and
      // nobody proposed at all.
      if (emailKey) seenEmails.add(emailKey);
      seenNames.set(key, (earlierLackedEmail ?? false) || !emailKey);
      contacts.push(person);
    } catch (e) {
      // Only a FieldError is a cell this reader refused. Anything else is a
      // bug here and should not be written down as the spreadsheet's fault.
      if (!(e instanceof FieldError)) throw e;
      skipped.push({ row, why: e.message });
    }
  });

  return { contacts, skipped };
}
