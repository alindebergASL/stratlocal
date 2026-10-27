// Which column is which, guessed and then confirmed by a person.
//
// The guess is the convenience; the confirmation is the point. A CRM export
// has a header row, so nothing here needs a model — "Close Date" is the close
// date, and paying for a model call to be told that would be both slower and
// less reliable than a table of synonyms. But a guess that is wrong is the
// worst possible failure for this screen: mapping "Expected Close" onto TCV
// writes a date into a money column across the whole pipeline in one accept,
// and the review cards would each look individually plausible. So the mapping
// is always shown and always submitted, and an unguessed column stays unmapped
// rather than being assigned to whatever is closest.
import type { ContactOrg, DealStatus } from "../db";

/** What a file is a list of. A person confirms this the same way they confirm
 *  the mapping, because the two guesses fail the same way: plausibly. */
export type SheetKind = "deal" | "contact" | "install_base";

export const KIND_LABELS: Record<SheetKind, string> = { deal: "Deals", contact: "People", install_base: "Install base" };

/** A field of a deal a column can be mapped onto. */
export type DealField =
  | "deal_id"
  | "name"
  | "stage"
  | "stage_label"
  | "close_date"
  | "tcv_usd"
  | "status"
  | "owner"
  | "next_step"
  | "competitor"
  | "partner"
  | "architecture"
  | "notes";

/** A field of a person. `name` and `notes` are shared with a deal on purpose:
 *  they are one column in a mapping, and which record they land on is decided
 *  by the kind, not by a second spelling of the same field. */
export type ContactField = "name" | "email" | "title" | "org" | "role" | "notes";

/** A line of an install base. No date: a snapshot's date is one answer for the
 *  whole file, typed by the person importing it (DECISIONS #19). */
export type InstallBaseField = "product_family" | "value_usd" | "share_pct" | "role_note";

export type SheetField = DealField | ContactField | InstallBaseField;

export type FieldSpec = {
  field: SheetField;
  label: string;
  /** What this column has to contain for the row to be usable at all. */
  required?: boolean;
  hint?: string;
  /** Lowercased header spellings that mean this field. Matched exactly, after
   *  normalisation — a substring match would put "Close Date" and "Created
   *  Date" in the same bucket. */
  aliases: string[];
};

export const DEAL_FIELDS: FieldSpec[] = [
  {
    field: "name",
    label: "Name",
    required: true,
    hint: "The only column a row cannot do without.",
    aliases: ["name", "deal name", "opportunity name", "opportunity", "deal", "title", "subject"],
  },
  {
    field: "deal_id",
    label: "CRM ID",
    hint: "Leave unmapped and every row is treated as new. Mapped, a row that matches an id already here becomes an update.",
    aliases: ["deal id", "dealid", "crm id", "opportunity id", "opportunity number", "opp id", "id", "record id", "number"],
  },
  { field: "stage", label: "Stage (1-6)", aliases: ["stage", "stage number", "sales stage", "stage no"] },
  { field: "stage_label", label: "Stage name", aliases: ["stage name", "stage label", "sales stage name", "phase"] },
  { field: "close_date", label: "Close date", aliases: ["close date", "closedate", "expected close", "expected close date", "forecast close", "close"] },
  { field: "tcv_usd", label: "Value", aliases: ["tcv", "tcv usd", "amount", "value", "deal value", "total contract value", "acv", "bookings"] },
  { field: "status", label: "Status", aliases: ["status", "open closed", "won lost", "outcome", "state"] },
  { field: "owner", label: "Owner", aliases: ["owner", "deal owner", "opportunity owner", "account executive", "ae", "rep", "seller"] },
  { field: "next_step", label: "Next step", aliases: ["next step", "next steps", "next action"] },
  { field: "competitor", label: "Competitor", aliases: ["competitor", "competitors", "competition", "incumbent"] },
  { field: "partner", label: "Partner", aliases: ["partner", "partners", "reseller", "channel partner"] },
  // Not the vendor's own word for this grouping, which scripts/privacy-check
  // refuses and which this app calls a product family everywhere else — the
  // check caught it in this list the moment the file became tracked.
  { field: "architecture", label: "Architecture", aliases: ["architecture", "solution", "technology", "product line", "product family"] },
  { field: "notes", label: "Notes", aliases: ["notes", "note", "comments", "description", "summary"] },
];

export const CONTACT_FIELDS: FieldSpec[] = [
  {
    field: "name",
    label: "Name",
    required: true,
    hint: "The only column a row cannot do without.",
    aliases: ["name", "full name", "contact", "contact name", "person", "attendee"],
  },
  {
    field: "email",
    label: "Email",
    hint: "Unmapped, people are matched by name alone, which is the weaker of the two.",
    aliases: ["email", "e mail", "email address", "e mail address", "mail", "work email"],
  },
  { field: "title", label: "Job title", aliases: ["title", "job title", "position", "role title", "designation"] },
  {
    field: "org",
    label: "Side",
    hint: "Unmapped, everyone in the file is taken to be at the customer.",
    aliases: ["org", "organisation", "organization", "company", "side", "type", "account type"],
  },
  { field: "role", label: "Role here", aliases: ["role", "contact role", "function", "persona"] },
  { field: "notes", label: "Notes", aliases: ["notes", "note", "comments", "description", "about"] },
];

export const INSTALL_BASE_FIELDS: FieldSpec[] = [
  {
    field: "product_family",
    label: "Product family",
    required: true,
    hint: "The only column a row cannot do without.",
    // Generic on purpose, the way `architecture` above is: the vendor's own
    // word for this grouping is one scripts/privacy-check.mjs refuses, and it
    // caught it in this very list the first time the file was tracked.
    aliases: ["product family", "family", "product", "product group", "product line", "category", "portfolio"],
  },
  { field: "value_usd", label: "Value", aliases: ["value", "amount", "installed value", "install base", "installed base", "spend", "revenue"] },
  {
    field: "share_pct",
    label: "Share %",
    hint: "Our share of that family, 0 to 100.",
    aliases: ["share", "share pct", "share percent", "our share", "share of wallet", "percent", "percentage"],
  },
  { field: "role_note", label: "Note", aliases: ["note", "notes", "comment", "comments", "role", "role note", "description"] },
];

export const FIELDS_BY_KIND: Record<SheetKind, FieldSpec[]> = {
  deal: DEAL_FIELDS,
  contact: CONTACT_FIELDS,
  install_base: INSTALL_BASE_FIELDS,
};

export function fieldsFor(kind: SheetKind): FieldSpec[] {
  return FIELDS_BY_KIND[kind];
}

function specFor(kind: SheetKind, field: SheetField): FieldSpec | undefined {
  return FIELDS_BY_KIND[kind].find((f) => f.field === field);
}

/** Column index per field; null where no column holds it. */
export type SheetMapping = Partial<Record<SheetField, number | null>>;

// Punctuation and case vary between exports of the same CRM ("Deal ID",
// "deal_id", "Deal Id."), and none of that variation is meaningful.
export function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A first guess at the mapping from the header row.
 *
 * First column wins a tie, and a column is used once: two columns both called
 * "Amount" would otherwise both be claimed, and the second silently ignored
 * with no sign on the screen that it was ever there.
 */
export function guessMapping(headers: string[], kind: SheetKind): SheetMapping {
  const normalised = headers.map(normaliseHeader);
  const taken = new Set<number>();
  const mapping: SheetMapping = {};
  for (const spec of fieldsFor(kind)) {
    const i = normalised.findIndex((h, idx) => !taken.has(idx) && h !== "" && spec.aliases.includes(h));
    if (i === -1) {
      mapping[spec.field] = null;
      continue;
    }
    taken.add(i);
    mapping[spec.field] = i;
  }
  return mapping;
}

/**
 * What is wrong with a mapping, in the words of the person who has to fix it.
 * Empty means it can be applied.
 */
export function mappingProblems(mapping: SheetMapping, headers: string[], kind: SheetKind): string[] {
  const out: string[] = [];
  const used = new Map<number, SheetField[]>();
  for (const spec of fieldsFor(kind)) {
    const i = mapping[spec.field];
    if (i === null || i === undefined) {
      if (spec.required) out.push(`Nothing is mapped to ${spec.label}, and a row needs one.`);
      continue;
    }
    if (!Number.isInteger(i) || i < 0 || i >= headers.length) {
      out.push(`${spec.label} points at a column that is not in this file.`);
      continue;
    }
    used.set(i, [...(used.get(i) ?? []), spec.field]);
  }
  // One column cannot be two fields. Allowing it would write the same text
  // into both and look like it worked.
  for (const [i, fields] of used) {
    if (fields.length > 1) {
      const names = fields.map((f) => specFor(kind, f)?.label ?? f).join(" and ");
      out.push(`“${headers[i]}” is mapped to both ${names}. Pick one.`);
    }
  }
  return out;
}

// Headers only one kind of file has. A deal export and a people export share
// Name and Notes and nothing else, so the distinctive ones are what decide.
// Headers only one kind of file has. The shared ones are excluded on both
// sides — a deal and a person both have a Name, a deal and an install-base
// line both have a Value — so only the distinctive columns get a vote.
const tells = (fields: FieldSpec[], shared: string[]) =>
  new Set(fields.filter((f) => !shared.includes(f.field)).flatMap((f) => f.aliases));

const DEAL_TELLS = tells(DEAL_FIELDS, ["name", "notes"]);
const CONTACT_TELLS = tells(CONTACT_FIELDS, ["name", "notes"]);
// `value_usd` is excluded because "value" and "amount" are a deal's money
// column too, and `role_note` because "notes" is everybody's. What is left —
// the product family and the share — is what an install base actually looks
// like on a page.
const INSTALL_BASE_TELLS = tells(INSTALL_BASE_FIELDS, ["value_usd", "role_note"]);

/**
 * What this file looks like a list of.
 *
 * A guess, and shown as one: the kind is a control on the screen exactly as
 * the mapping is, because getting it wrong is not a failure that announces
 * itself — a people file read as deals proposes a pipeline of deals named
 * after colleagues, and each card reads plausibly on its own.
 *
 * A tie goes to deals, which is the file this import was built for and the one
 * that has a header a CRM wrote.
 */
export function guessKind(headers: string[]): SheetKind {
  const normalised = headers.map(normaliseHeader).filter((h) => h !== "");
  const score: Record<SheetKind, number> = { deal: 0, contact: 0, install_base: 0 };
  for (const h of normalised) {
    // A header that means something to more than one kind counts for each, so
    // it cannot tip the balance on its own — "product family" is an install
    // base's subject and a deal's architecture, and it decides nothing alone.
    if (DEAL_TELLS.has(h)) score.deal += 1;
    if (CONTACT_TELLS.has(h)) score.contact += 1;
    if (INSTALL_BASE_TELLS.has(h)) score.install_base += 1;
  }
  if (score.contact > score.deal && score.contact > score.install_base) return "contact";
  if (score.install_base > score.deal && score.install_base > score.contact) return "install_base";
  return "deal";
}

/** Which side of the table a person sits on, in the words a file uses. */
export const ORG_WORDS: Record<string, ContactOrg> = {
  customer: "customer",
  client: "customer",
  "end user": "customer",
  "end customer": "customer",
  buyer: "customer",
  them: "customer",
  vendor: "vendor",
  internal: "vendor",
  us: "vendor",
  "our team": "vendor",
  seller: "vendor",
  partner: "partner",
  reseller: "partner",
  channel: "partner",
  "channel partner": "partner",
  distributor: "partner",
  si: "partner",
};

/** What a person does here. The stored vocabulary, plus the spellings a
 *  spreadsheet writes it in. */
export const ROLE_WORDS: Record<string, string> = {
  ae: "ae",
  "account executive": "ae",
  "account manager": "ae",
  se: "se",
  "systems engineer": "se",
  "sales engineer": "se",
  "solutions engineer": "se",
  specialist_ae: "specialist_ae",
  "specialist ae": "specialist_ae",
  specialist: "specialist_ae",
  specialist_se: "specialist_se",
  "specialist se": "specialist_se",
  partner: "partner",
  executive: "executive",
  exec: "executive",
  "decision maker": "executive",
  sponsor: "executive",
  it_leader: "it_leader",
  "it leader": "it_leader",
  "it manager": "it_leader",
  "it director": "it_leader",
  technical: "technical",
  architect: "technical",
  engineer: "technical",
  "technical buyer": "technical",
  procurement: "procurement",
  purchasing: "procurement",
  sourcing: "procurement",
  other: "other",
};

/** Statuses a cell can say, in the spellings an export actually uses. */
export const STATUS_WORDS: Record<string, DealStatus> = {
  open: "open",
  active: "open",
  "in progress": "open",
  pipeline: "open",
  forecast: "open",
  committed: "open",
  won: "won",
  "closed won": "won",
  "closed-won": "won",
  booked: "won",
  lost: "lost",
  "closed lost": "lost",
  "closed-lost": "lost",
  "no decision": "lost",
};
