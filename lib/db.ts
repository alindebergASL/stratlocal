// SQLite access. One connection per process, opened lazily. The whole schema
// lives in in-code migrations applied at boot; there is no separate migrate
// step to forget. Conventions: TEXT uuid primary keys, epoch-milliseconds
// INTEGER timestamps, JSON columns suffixed _json.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashPassword } from "./password";
import { newId } from "./ids";
import { LOCAL_SCHEMA } from "./local/schema";

export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "strategy.sqlite");
const IN_MEMORY = DB_PATH === ":memory:";
export const DATA_DIR = IN_MEMORY ? fs.mkdtempSync(path.join(os.tmpdir(), "strategy-")) : path.dirname(DB_PATH);
export const DOCS_DIR = path.join(DATA_DIR, "docs");

// Next bundles this module into more than one server chunk, so a plain module
// variable would give each chunk its own connection. globalThis keeps one.
const g = globalThis as unknown as { __strategyDb?: Database.Database | null };
let _db: Database.Database | null = g.__strategyDb ?? null;

type Migration = { id: string; up: (conn: Database.Database) => void };

const MIGRATIONS: Migration[] = [
  {
    id: "001_init",
    up(conn) {
      conn.exec(`
        CREATE TABLE users (
          id                 TEXT PRIMARY KEY,
          email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash      TEXT NOT NULL,
          display_name       TEXT NOT NULL,
          failed_login_count INTEGER NOT NULL DEFAULT 0,
          locked_until       INTEGER,
          created_at         INTEGER NOT NULL,
          updated_at         INTEGER NOT NULL
        );

        CREATE TABLE sessions (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX idx_sessions_user ON sessions(user_id);

        CREATE TABLE accounts (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          crm_id       TEXT,
          legal_entity TEXT,
          region       TEXT,
          segment      TEXT,
          hq           TEXT,
          thesis       TEXT,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        );

        CREATE TABLE contacts (
          id         TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name       TEXT NOT NULL,
          title      TEXT,
          org        TEXT NOT NULL DEFAULT 'customer' CHECK (org IN ('customer','vendor','partner')),
          role       TEXT,
          email      TEXT,
          notes      TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_contacts_account ON contacts(account_id);

        CREATE TABLE deals (
          deal_id        TEXT PRIMARY KEY,
          account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name           TEXT NOT NULL,
          stage          INTEGER CHECK (stage BETWEEN 1 AND 6),
          stage_label    TEXT,
          close_date     TEXT,
          fiscal_quarter TEXT,
          tcv_usd        INTEGER,
          competitor     TEXT,
          partner        TEXT,
          architecture   TEXT,
          owner          TEXT,
          next_step      TEXT,
          notes          TEXT,
          status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL
        );
        CREATE INDEX idx_deals_account ON deals(account_id);

        CREATE TABLE install_base (
          id             TEXT PRIMARY KEY,
          account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          product_family TEXT NOT NULL,
          value_usd      INTEGER,
          share_pct      REAL,
          role_note      TEXT,
          as_of          TEXT NOT NULL,
          document_id    TEXT,
          created_at     INTEGER NOT NULL,
          UNIQUE (account_id, product_family, as_of)
        );

        CREATE TABLE plays (
          id               TEXT PRIMARY KEY,
          account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          title            TEXT NOT NULL,
          thesis           TEXT,
          status           TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','stalled','won','dropped')),
          owner            TEXT,
          next_step        TEXT,
          next_step_due    TEXT,
          deal_ids_json    TEXT NOT NULL DEFAULT '[]',
          contact_ids_json TEXT NOT NULL DEFAULT '[]',
          sort_order       INTEGER NOT NULL DEFAULT 0,
          created_at       INTEGER NOT NULL,
          updated_at       INTEGER NOT NULL
        );
        CREATE INDEX idx_plays_account ON plays(account_id);

        CREATE TABLE meetings (
          id             TEXT PRIMARY KEY,
          account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          title          TEXT NOT NULL,
          held_at        TEXT NOT NULL,
          attendees_json TEXT NOT NULL DEFAULT '[]',
          raw_notes      TEXT,
          summary        TEXT,
          brief_json     TEXT,
          created_by     TEXT,
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL
        );
        CREATE INDEX idx_meetings_account ON meetings(account_id, held_at);

        CREATE TABLE action_items (
          id              TEXT PRIMARY KEY,
          account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          meeting_id      TEXT,
          play_id         TEXT,
          text            TEXT NOT NULL,
          owner           TEXT,
          due             TEXT,
          status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
          source_ref_json TEXT,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );
        CREATE INDEX idx_action_items_account ON action_items(account_id, status);

        CREATE TABLE documents (
          id           TEXT PRIMARY KEY,
          account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          kind         TEXT NOT NULL CHECK (kind IN ('agent_report','research_note','handoff','other')),
          filename     TEXT NOT NULL,
          mime         TEXT,
          byte_size    INTEGER NOT NULL DEFAULT 0,
          sha256       TEXT,
          storage_path TEXT,
          content_text TEXT,
          meta_json    TEXT,
          status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','accepted')),
          ai_run_id    TEXT,
          created_by   TEXT,
          created_at   INTEGER NOT NULL
        );
        CREATE INDEX idx_documents_account ON documents(account_id, created_at DESC);

        CREATE TABLE proposals (
          id              TEXT PRIMARY KEY,
          account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          batch_id        TEXT NOT NULL,
          origin_kind     TEXT NOT NULL CHECK (origin_kind IN ('import','meeting','plan_draft')),
          origin_id       TEXT,
          ai_run_id       TEXT,
          entity_type     TEXT NOT NULL CHECK (entity_type IN ('account','contact','deal','install_base','play','action_item','meeting')),
          entity_id       TEXT,
          op              TEXT NOT NULL CHECK (op IN ('create','update')),
          payload_json    TEXT NOT NULL,
          before_json     TEXT,
          rationale       TEXT,
          source_ref_json TEXT,
          status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','conflict')),
          decided_by      TEXT,
          decided_at      INTEGER,
          created_at      INTEGER NOT NULL
        );
        CREATE INDEX idx_proposals_account_status ON proposals(account_id, status);
        CREATE INDEX idx_proposals_batch ON proposals(batch_id);

        CREATE TABLE change_log (
          id              TEXT PRIMARY KEY,
          account_id      TEXT NOT NULL,
          entity_type     TEXT NOT NULL,
          entity_id       TEXT NOT NULL,
          field           TEXT NOT NULL,
          old_value       TEXT,
          new_value       TEXT,
          actor_user_id   TEXT,
          proposal_id     TEXT,
          source_ref_json TEXT,
          created_at      INTEGER NOT NULL
        );
        CREATE INDEX idx_change_log_entity ON change_log(entity_type, entity_id, created_at DESC);
        CREATE INDEX idx_change_log_account ON change_log(account_id, created_at DESC);

        CREATE TABLE ai_runs (
          id            TEXT PRIMARY KEY,
          account_id    TEXT,
          kind          TEXT NOT NULL,
          provider      TEXT NOT NULL,
          model         TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
          input_summary TEXT,
          usage_json    TEXT,
          cost_cents    INTEGER,
          error         TEXT,
          result_json   TEXT,
          created_by    TEXT,
          started_at    INTEGER NOT NULL,
          finished_at   INTEGER
        );
        CREATE INDEX idx_ai_runs_started ON ai_runs(started_at DESC);
      `);
    },
  },
  {
    // Soft archive. Nothing is ever deleted: history is a feature here, and a
    // record that produced change_log lines has to stay resolvable. A row with
    // archived_at set is hidden from every list, prompt and proposal path, and
    // can be restored. The value is a YYYY-MM-DD day, matching the other dates
    // a person sees; change_log.created_at already carries the exact moment.
    id: "002_archive",
    up(conn) {
      for (const table of ["accounts", "contacts", "deals", "plays", "meetings", "action_items"]) {
        conn.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
      }
    },
  },
  {
    // Documents were left out of 002 because nothing could create a bad one:
    // an upload was always deliberate. A research note is not — the model
    // writes it — so there has to be a way to take one back, and the same
    // column lets a mistaken upload be hidden too.
    //
    // Documents stay OUT of ARCHIVABLE in lib/proposals/schema.ts. They are
    // not an entity anyone can propose (proposals.entity_type has no
    // 'document'), so they do not belong in the apply path; archiving one is
    // its own small writer in lib/research/notes.ts.
    id: "003_document_archive",
    up(conn) {
      conn.exec(`ALTER TABLE documents ADD COLUMN archived_at TEXT`);
    },
  },
  {
    // Two rows for one opportunity, pointed at each other.
    //
    // A seller opens a deal before the CRM has one, works it, and then the
    // report arrives with the real id — which the import matches by id alone,
    // so it creates a second row. Merging them archives the loser, and this
    // column is what says the loser is a tombstone rather than an ordinary
    // archived deal.
    //
    // It is a column and not a change_log row because four readers need to
    // answer "is this a tombstone, and pointing where" as a WHERE clause:
    // diffExtraction (which is pure and can only see the state it is handed,
    // and which would otherwise propose restoring the loser on every future
    // import), restoreEntity, the archived list, and the deal page. The
    // merged_from / merged_into history rows stay as the narrative — the same
    // split moveDeal already uses.
    //
    // Deliberately NOT in DealPatch: it is written by merge alone, so no
    // proposal and no form can reach it.
    id: "004_deal_merge",
    up(conn) {
      conn.exec(`ALTER TABLE deals ADD COLUMN merged_into TEXT`);
    },
  },
  {
    // Two reads that were scanning a whole table.
    //
    // mergedDealIds walks `WHERE merged_into = ?` once per node of the merge
    // chain, on every deal-page render, and 004 added the column without an
    // index. entityLabels reads install_base by account, one of the eight
    // reads it does per account — and /activity does that for every account
    // with a hand edit on the page.
    id: "005_indexes",
    up(conn) {
      conn.exec(`CREATE INDEX IF NOT EXISTS idx_deals_merged_into ON deals(merged_into)`);
      conn.exec(`CREATE INDEX IF NOT EXISTS idx_install_base_account ON install_base(account_id)`);
    },
  },
  {
    // Home reads change_log on every render.
    //
    // recentChanges was rewritten to fold raw rows in JS, because the day
    // bucket has to be a calendar day in APP_TIMEZONE. Its hand-edit half is
    // `WHERE created_at >= ? AND proposal_id IS NULL`, and neither existing
    // index starts with either column — idx_change_log_entity leads with
    // entity_type, idx_change_log_account with account_id. So it scanned the
    // whole table and sorted it in a temp b-tree, on the one page that is
    // opened most.
    id: "006_change_log_recent",
    up(conn) {
      conn.exec(`CREATE INDEX IF NOT EXISTS idx_change_log_recent ON change_log(proposal_id, created_at DESC)`);
    },
  },
  {
    // Who owes a follow-up, as a person rather than as a string.
    //
    // `owner` stays: it is free text because a follow-up can belong to someone
    // at the customer, and because extraction writes down whatever the notes
    // said. What it cannot do is answer "what do I owe" — "Jamie" and
    // "Jamie L." are two different owners to a query. owner_user_id is that
    // answer, set from a picker, and left null when the person is not one of
    // us.
    id: "007_action_item_owner",
    up(conn) {
      // No foreign key, deliberately, and for the same reason
      // change_log.actor_user_id has none: a user row is a login, and a
      // record of who owns something should not be what stops one being
      // removed or block a restore from a backup taken either side of a
      // change. saveActionItem validates the id against listUsers() on the
      // way in, which is where the check belongs.
      conn.exec(`ALTER TABLE action_items ADD COLUMN owner_user_id TEXT`);
      conn.exec(`CREATE INDEX IF NOT EXISTS idx_action_items_owner ON action_items(owner_user_id, status)`);
    },
  },
  {
    id: "008_meeting_time",
    up(conn) {
      // What time the meeting is, when anyone said.
      //
      // held_at has always been a bare date, so "Coming up" ordered the day's
      // calls by `held_at, account name` — alphabetically, on the page whose
      // entire job is what happens next. And "happened, no notes yet" filtered
      // held_at < today, so the prompt to write notes arrived the following
      // morning rather than in the ten minutes after the call, which is when
      // the notes exist.
      //
      // Nullable, and stays nullable: every meeting already on file has no
      // time, a meeting genuinely can be "some time on Thursday", and a column
      // that forced a guess would make the ordering confidently wrong instead
      // of honestly unknown.
      conn.exec(`ALTER TABLE meetings ADD COLUMN held_time TEXT`);
      conn.exec(`CREATE INDEX IF NOT EXISTS idx_meetings_when ON meetings(held_at, held_time)`);
    },
  },
  {
    // Whose account it is.
    //
    // Two people share fifteen accounts and the app has never known which of
    // them runs which. Home listed all fifteen identically to both, the
    // pipeline could filter by a deal's `owner` — free text the CRM report
    // writes, where "Jamie" and "Jamie L." are two different owners — and
    // nothing anywhere answered "show me mine". Ownership belongs on the
    // account, because that is the unit the two of them actually divide: the
    // deals, meetings, follow-ups and history under an account are all that
    // person's to work.
    //
    // Nullable, and nullable for a reason rather than for migration
    // convenience: an account both of them run together is the honest third
    // answer, and forcing every account to name one owner would make the
    // filter lie about the ones they share.
    id: "009_account_owner",
    up(conn) {
      // No foreign key, deliberately, for the same reason 007 gave for
      // action_items.owner_user_id and change_log.actor_user_id has none: a
      // user row is a login, and a note of who runs an account should not be
      // what stops one being removed or what breaks a restore from a backup
      // taken either side of a change. updateAccount validates the id against
      // listUsers() on the way in, which is where the check belongs.
      conn.exec(`ALTER TABLE accounts ADD COLUMN owner_user_id TEXT`);
      conn.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_user_id)`);
    },
  },
  {
    // A handoff, and the link that lets somebody without a login read it.
    //
    // documents.kind has allowed 'handoff' since the first migration and
    // nothing has ever written one. What was missing is the sharing: a token
    // to address it by, and a date after which that token stops working.
    //
    // Both on documents rather than in meta_json, because both are queried
    // rather than displayed — the token is looked up on every request to a
    // shared page, and it has to be unique. A blob cannot be indexed and
    // cannot be constrained.
    id: "010_document_share",
    up(conn) {
      conn.exec(`ALTER TABLE documents ADD COLUMN share_token TEXT`);
      conn.exec(`ALTER TABLE documents ADD COLUMN share_expires_at INTEGER`);
      // UNIQUE, so two documents can never answer to one token, and partial
      // so the thousands of documents with no token do not all collide on
      // NULL — SQLite treats NULLs as distinct in a unique index, but the
      // partial index is smaller and says what it is for.
      conn.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_share ON documents(share_token) WHERE share_token IS NOT NULL`);
    },
  },
  {
    // A word on the link, for the one page with no login. Only the hash is
    // stored: the sender typed the passphrase, so nobody needs it back, and a
    // forgotten one is answered by sharing again rather than by recovery.
    id: "011_share_passphrase",
    up(conn) {
      conn.exec(`ALTER TABLE documents ADD COLUMN share_passphrase_hash TEXT`);
    },
  },
  {
    // Somewhere for work that is not about a customer.
    //
    // Every follow-up has always needed an account, so "build the forecast",
    // "prep the QBR deck" and "chase the partner agreement" had nowhere to
    // live — the app had a todo list and no way to put your own work on it.
    //
    // A flagged account rather than a nullable account_id, deliberately. The
    // nullable version is tidier in the schema and worse everywhere else:
    // change_log.account_id is NOT NULL too, so the audit spine would have to
    // be rebuilt, and every follow-up query inner-joins accounts, so a missed
    // join would hide a todo with no error at all. This way the joins keep
    // working untouched, an account-less todo appears on Home and in search
    // for free, and the failure mode if a list forgets to exclude it is a row
    // on screen that should not be there — visible, not silent.
    id: "012_own_work_account",
    up(conn) {
      conn.exec(`ALTER TABLE accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','own_work'))`);
    },
  },
  {
    // An install-base row becomes a record like every other one.
    //
    // It was the only entity table with neither column, on the position that a
    // dated snapshot is replaced rather than curated. That is right about what
    // a snapshot is and has no answer for one that was wrong when it was
    // taken: a figure the model misread from a report table was permanent, and
    // the trend on the account page is read off it.
    //
    // `updated_at` is backfilled from `created_at` rather than left at zero,
    // because it is what an edit form sends back as its `base_version` — a row
    // claiming it was last touched at the epoch would make the first save of
    // every existing row look like someone else's concurrent edit.
    id: "013_install_base_curation",
    up(conn) {
      conn.exec(`ALTER TABLE install_base ADD COLUMN archived_at TEXT`);
      conn.exec(`ALTER TABLE install_base ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`);
      conn.exec(`UPDATE install_base SET updated_at = created_at`);
    },
  },
  {
    // One human, at more than one account.
    //
    // `contacts.account_id` is NOT NULL and stays that way: each account keeps
    // its own row for a person, because their role, their title and what you
    // have written about them genuinely are per-account. What was missing was
    // only the connection between the rows.
    //
    // A shared group id rather than a pointer. `deals.merged_into` is a
    // pointer and needs `mergedDealIds` to walk the chain with a visited set
    // and a depth cap, because bad data must not hang a page render. Rows that
    // share a uuid have no chain to walk, no cycle to guard, no direction to
    // get backwards, and unlink by being cleared.
    id: "014_person_link",
    up(conn) {
      conn.exec(`ALTER TABLE contacts ADD COLUMN person_id TEXT`);
      conn.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_person ON contacts(person_id)`);
    },
  },
  {
    // Two rows for one play, and two records of one meeting.
    //
    // The same pointer 004 gave deals, and for the same two reasons — one of
    // which is specific to plays and one of which is not.
    //
    // Specific to plays: diffExtraction and diffPlanDraft both match a play by
    // normalised title against a list that INCLUDES archived rows, on purpose.
    // Archive the loser and nothing else and the next report finds that title,
    // proposes clearing `archived_at`, and one Accept all brings the duplicate
    // back — on every import, forever. That is the deal lesson of Phase 6,
    // arriving at the other record it applies to.
    //
    // Not specific to plays: the Archived block offers Restore for every
    // archived row, and a restored loser comes back with its follow-ups and
    // its links now answering to the keeper. Half a record, which is what
    // restoreEntity already refuses for a merged-away deal. Nothing matches a
    // meeting by its content, so a meeting cannot be resurrected by an
    // importer — but it can be restored, which is why it gets the column too.
    //
    // No index on either, unlike 005's on deals: that one exists because
    // mergedDealIds walks the chain on every deal-page render across hundreds
    // of deals. A year of use is ~8 plays and ~30 meetings per account, so an
    // index here would be a cost on every write for a scan of a hundred rows.
    // Measured with `npm run measure` rather than assumed (Phase 11's rule).
    //
    // Deliberately NOT in PlayPatch or MeetingPatch: written by merge alone,
    // so no proposal and no form can reach either one.
    id: "015_record_merge",
    up(conn) {
      conn.exec(`ALTER TABLE plays ADD COLUMN merged_into TEXT`);
      conn.exec(`ALTER TABLE meetings ADD COLUMN merged_into TEXT`);
    },
  },
  {
    // A loose thought, and a brief a person has edited.
    //
    // `action_items.notes` is the body of a task written down before it has
    // an account, a meeting or a date — the thing that used to go nowhere
    // because every follow-up form sat inside a record. Free text, bounded by
    // the patch schema, never read by a prompt.
    //
    // `meetings.brief_edits_json` is what makes a human edit to a brief
    // honest. The brief on the page is the edited one; this holds the
    // complete original the model wrote, with who edited it and when, so the
    // edit is labelled as a person's words and never presented as
    // evidence-checked output. A regeneration clears it, and asks first,
    // because a stored brief with human edits is not a thing to overwrite
    // silently (DECISIONS #9, #36).
    //
    // Both additive, both nullable, no backfill: every existing row simply
    // has neither. No index — each is read by its own row's page and nothing
    // ever searches on either.
    id: "016_planning_workspace",
    up(conn) {
      conn.exec(`ALTER TABLE action_items ADD COLUMN notes TEXT`);
      conn.exec(`ALTER TABLE meetings ADD COLUMN brief_edits_json TEXT`);
    },
  },
  {
    // Assistants that start on their own (DECISIONS #38).
    //
    // `ai_runs.assistant` names the assistant that started a model run on its
    // own; a run someone pressed a button for leaves it null and is charged
    // to the people's share. That one column is what the per-assistant
    // budgets are summed from.
    //
    // `settings` holds the budget numbers a person sets on the Assistants
    // page; the environment only supplies the first values. One row per key,
    // with who changed it.
    //
    // `assistant_settings` is each assistant's mode and monthly limit. A
    // missing row means the assistant's defaults.
    //
    // `assistant_runs` is one row each time an assistant looked, whether or
    // not it called a model: Promise keeper reads follow-ups and never does,
    // and "it checked and found nothing" is an answer worth keeping. Model
    // runs it started point back here through ai_runs.assistant and the time.
    //
    // `assistant_notices` is what an assistant leaves for a person: a notice
    // (something is coming, nothing to do) or a question (it needs an
    // answer). Never a change to a record. `dedupe_key` is unique, so a
    // daily run cannot say the same thing twice; a notice about a follow-up
    // whose date has since moved has a different key and is a new notice.
    id: "017_assistants",
    up(conn) {
      conn.exec(`ALTER TABLE ai_runs ADD COLUMN assistant TEXT`);
      conn.exec(`
        CREATE INDEX idx_ai_runs_assistant ON ai_runs(assistant, started_at);

        CREATE TABLE settings (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_by TEXT,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE assistant_settings (
          assistant     TEXT PRIMARY KEY,
          mode          TEXT NOT NULL CHECK (mode IN ('off','ask','auto')),
          monthly_cents INTEGER NOT NULL CHECK (monthly_cents >= 0),
          updated_by    TEXT,
          updated_at    INTEGER NOT NULL
        );

        CREATE TABLE assistant_runs (
          id           TEXT PRIMARY KEY,
          assistant    TEXT NOT NULL,
          trigger      TEXT NOT NULL CHECK (trigger IN ('schedule','manual')),
          status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed','skipped')),
          summary      TEXT,
          result_json  TEXT,
          error        TEXT,
          created_by   TEXT,
          started_at   INTEGER NOT NULL,
          finished_at  INTEGER
        );
        CREATE INDEX idx_assistant_runs ON assistant_runs(assistant, started_at DESC);

        CREATE TABLE assistant_notices (
          id             TEXT PRIMARY KEY,
          assistant      TEXT NOT NULL,
          kind           TEXT NOT NULL CHECK (kind IN ('notify','question')),
          account_id     TEXT NOT NULL,
          action_item_id TEXT,
          for_user_id    TEXT,
          text           TEXT NOT NULL,
          dedupe_key     TEXT NOT NULL UNIQUE,
          run_id         TEXT,
          created_at     INTEGER NOT NULL,
          resolved_at    INTEGER,
          resolved_by    TEXT,
          resolution     TEXT CHECK (resolution IN ('dismissed','answered'))
        );
        CREATE INDEX idx_assistant_notices_open ON assistant_notices(resolved_at, created_at DESC);
      `);
    },
  },
  {
    // Which spellings of a deal owner are one person. A deal's `owner` is
    // free text the CRM report writes — "Jamie", "Jamie L.", "Jamie Lee" —
    // and it stays exactly as written, because the next report will write it
    // again and a column the import fights with is a column that flips back.
    // This table sits beside it: each row says "this spelling is that name",
    // and a person confirms every one (lib/dealOwners.ts). Keyed by the
    // spelling normalised for case and spacing, so " jamie  l. " and
    // "Jamie L." are one key. Not account-scoped: an owner is the same person
    // on every account, and the pipeline asks the question across all of
    // them.
    id: "018_deal_owner_aliases",
    up(conn) {
      conn.exec(`CREATE TABLE deal_owner_aliases (
        alias       TEXT PRIMARY KEY,
        canonical   TEXT NOT NULL,
        created_by  TEXT,
        created_at  INTEGER NOT NULL
      )`);
    },
  },
  {
    // What a merge did, kept so it can be undone (lib/proposals/unmerge.ts).
    // `changes_json` is the before and after of every column the merge
    // changed, on every row it touched — the two records, every follow-up,
    // play, meeting or proposal it relinked or rejected — captured inside
    // the merge's own transaction. History alone could not do this: it keeps
    // a meeting's notes by size only, and some of a merge's writes are not
    // history rows at all. `log_seq` is the highest change_log rowid when the
    // merge finished: any history row after it, on a field the merge wrote,
    // is a later edit — even one that put the same value back. A merge made
    // before this migration has no receipt, and is not offered for undoing.
    id: "019_merge_receipts",
    up(conn) {
      conn.exec(`CREATE TABLE merge_receipts (
        id            TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL,
        entity_type   TEXT NOT NULL CHECK (entity_type IN ('contact','deal','play','meeting')),
        keeper_id     TEXT NOT NULL,
        loser_id      TEXT NOT NULL,
        keeper_label  TEXT NOT NULL,
        loser_label   TEXT NOT NULL,
        actor_user_id TEXT,
        created_at    INTEGER NOT NULL,
        changes_json  TEXT NOT NULL,
        log_seq       INTEGER NOT NULL,
        undone_at     INTEGER,
        undone_by     TEXT
      )`);
      conn.exec(`CREATE INDEX idx_merge_receipts_account ON merge_receipts(account_id, created_at)`);
    },
  },
  {
    // A merged-away person gets the pointer deals, plays and meetings have
    // had since 004 and 015. Without it a merged contact was only an archived
    // one, and both importers match people against archived rows on purpose
    // — so importing the merged-away name again proposed restoring it, and
    // one Accept undid the merge. With it, the import follows the pointer to
    // the survivor and Restore refuses (DECISIONS #33).
    //
    // Merges made before this have no pointer, only their history lines.
    // Those are read back here: a contact's `merged_into` line and the
    // `merged_from` line on another contact of the same account written in
    // the same merge — the nearest within two seconds — name the pair. A
    // pair that cannot be found that way is left alone; a guessed pointer
    // would silently redirect an import onto the wrong person.
    id: "020_contact_merge_pointer",
    up(conn) {
      conn.exec(`ALTER TABLE contacts ADD COLUMN merged_into TEXT`);
      backfillContactMergePointers(conn);
    },
  },
  {
    // 018-020 here and 018-020 above share numbers: two branches each took
    // them, and one set may already have run somewhere when the other
    // arrived. An id is matched as a whole string, so both sets run, in this
    // order, and none is ever renamed. They create unrelated tables.
    //
    // Calendars, read only (DECISIONS #42).
    //
    // `calendar_sources` is one calendar the app reads: a published iCal
    // link, Strategy's own Outlook mailbox through Microsoft Graph, or a
    // Google calendar shared with a service account. `config_json` holds the
    // link or the mailbox and is never sent back to a browser once saved.
    // `owner_user_id` is whose calendar it is; only a person's own calendar
    // can say they are on time off. `watch_*` is the provider's push channel,
    // when there is one: it only ever says "something changed", and its
    // secret is how the hook route knows the call is real.
    //
    // `calendar_events` is what the last sync saw, one row per occurrence
    // (`event_key` is the provider's id plus the occurrence's start, so a
    // recurring meeting is one row a week). The day and time are stored in the
    // app's clock, as meetings are. `decision` is a person's: added (and the
    // meeting it became) or ignored. `account_id` is the match the code made,
    // or the account a person chose. An event that disappears from the
    // window is marked removed, not deleted, so an added meeting can say its
    // invite was cancelled. `ack_signature` is the day, time and state a
    // person last said "keep the meeting as it is" to, so a moved invite asks
    // once per move.
    id: "018_calendar",
    up(conn) {
      conn.exec(`
        CREATE TABLE calendar_sources (
          id               TEXT PRIMARY KEY,
          kind             TEXT NOT NULL CHECK (kind IN ('ics','graph','google')),
          label            TEXT NOT NULL,
          owner_user_id    TEXT,
          config_json      TEXT NOT NULL,
          last_synced_at   INTEGER,
          last_error       TEXT,
          last_count       INTEGER,
          watch_id         TEXT,
          watch_secret     TEXT,
          watch_expires_at INTEGER,
          created_by       TEXT,
          created_at       INTEGER NOT NULL,
          archived_at      INTEGER
        );

        CREATE TABLE calendar_events (
          id             TEXT PRIMARY KEY,
          source_id      TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
          event_key      TEXT NOT NULL,
          title          TEXT NOT NULL,
          day            TEXT NOT NULL,
          time           TEXT,
          end_day        TEXT NOT NULL,
          all_day        INTEGER NOT NULL DEFAULT 0,
          organizer_json TEXT,
          attendees_json TEXT NOT NULL DEFAULT '[]',
          busy           TEXT,
          cancelled      INTEGER NOT NULL DEFAULT 0,
          time_off       INTEGER NOT NULL DEFAULT 0,
          internal       INTEGER NOT NULL DEFAULT 0,
          account_id     TEXT,
          match_reason   TEXT,
          decision       TEXT CHECK (decision IN ('added','ignored')),
          meeting_id     TEXT,
          decided_by     TEXT,
          decided_at     INTEGER,
          removed_at     INTEGER,
          ack_signature  TEXT,
          first_seen_at  INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL,
          UNIQUE (source_id, event_key)
        );
        CREATE INDEX idx_calendar_events_day ON calendar_events(day);
        CREATE INDEX idx_calendar_events_meeting ON calendar_events(meeting_id);
      `);
    },
  },
  {
    // The accounts Account watch looks at each week. A row is a person's
    // choice; nothing adds one on its own, because each look costs money.
    id: "019_account_watch",
    up(conn) {
      conn.exec(`
        CREATE TABLE watched_accounts (
          account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
          added_by   TEXT,
          added_at   INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // Plan keeper's questions are about a play or the account thesis, not a
    // follow-up: `subject_id` names the play, and `payload_json` carries what
    // the question rests on (the quoted thesis clause and meeting sentence,
    // and the thesis as it was, so an edited thesis retires the question).
    id: "020_plan_keeper",
    up(conn) {
      conn.exec(`ALTER TABLE assistant_notices ADD COLUMN subject_id TEXT`);
      conn.exec(`ALTER TABLE assistant_notices ADD COLUMN payload_json TEXT`);
    },
  },
  {
    // What the team is for, in its own words (lib/teamDirection.ts): what it
    // sells, what it is trying to achieve, what makes an account worth its
    // time, and what to steer away from. One direction per install — a team
    // selling something else runs its own install. Append-only: each save is
    // a new row and the newest is current, so the history of what the team
    // said it was for is kept, with who said it. Not account-scoped, so not
    // in change_log.
    id: "021_team_direction",
    up(conn) {
      conn.exec(`CREATE TABLE team_direction (
        id               TEXT PRIMARY KEY,
        focus_areas_json TEXT NOT NULL,
        goals            TEXT,
        signals          TEXT,
        avoid            TEXT,
        created_by       TEXT,
        created_at       INTEGER NOT NULL
      )`);
    },
  },
  {
    // Two account records for one customer become one: the merged-away
    // account points at the one it lives in now (lib/proposals/mergeAccount.ts),
    // and a merge receipt may now be for an account. SQLite cannot alter a
    // CHECK, so the receipts table is rebuilt with every row carried over.
    id: "022_account_merge",
    up(conn) {
      conn.exec(`ALTER TABLE accounts ADD COLUMN merged_into TEXT`);
      conn.exec(`CREATE TABLE merge_receipts_new (
        id            TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL,
        entity_type   TEXT NOT NULL CHECK (entity_type IN ('contact','deal','play','meeting','account')),
        keeper_id     TEXT NOT NULL,
        loser_id      TEXT NOT NULL,
        keeper_label  TEXT NOT NULL,
        loser_label   TEXT NOT NULL,
        actor_user_id TEXT,
        created_at    INTEGER NOT NULL,
        changes_json  TEXT NOT NULL,
        log_seq       INTEGER NOT NULL,
        undone_at     INTEGER,
        undone_by     TEXT
      )`);
      conn.exec(`INSERT INTO merge_receipts_new SELECT id, account_id, entity_type, keeper_id, loser_id, keeper_label, loser_label, actor_user_id, created_at, changes_json, log_seq, undone_at, undone_by FROM merge_receipts`);
      conn.exec(`DROP TABLE merge_receipts`);
      conn.exec(`ALTER TABLE merge_receipts_new RENAME TO merge_receipts`);
      conn.exec(`CREATE INDEX idx_merge_receipts_account ON merge_receipts(account_id, created_at)`);
    },
  },
  {
    // Ask (lib/ask): conversations with an agent over everything on file. A
    // thread belongs to an account when it was started there, or to no
    // account. `saved = 0` is a "don't keep this one" thread, purged after a
    // day. Messages keep the answer text, its checked citations and the steps
    // it took; the tool results themselves are not kept.
    id: "023_ask",
    up(conn) {
      conn.exec(`CREATE TABLE ask_threads (
        id          TEXT PRIMARY KEY,
        account_id  TEXT,
        title       TEXT NOT NULL,
        saved       INTEGER NOT NULL DEFAULT 1,
        created_by  TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        archived_at TEXT
      )`);
      conn.exec(`CREATE INDEX idx_ask_threads_updated ON ask_threads(account_id, updated_at)`);
      conn.exec(`CREATE TABLE ask_messages (
        id                TEXT PRIMARY KEY,
        thread_id         TEXT NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
        role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
        text              TEXT NOT NULL,
        citations_json    TEXT,
        steps_json        TEXT,
        run_id            TEXT,
        proposal_batch_id TEXT,
        report_doc_id     TEXT,
        created_by        TEXT,
        created_at        INTEGER NOT NULL
      )`);
      conn.exec(`CREATE INDEX idx_ask_messages_thread ON ask_messages(thread_id, created_at)`);
    },
  },
  {
    // What a conversation is about when it started from a record's page or
    // from ⌘K on a page (lib/ask/focus.ts). Resolved every time it is read.
    id: "024_ask_focus",
    up: (conn) => {
      conn.exec(`ALTER TABLE ask_threads ADD COLUMN focus_kind TEXT`);
      conn.exec(`ALTER TABLE ask_threads ADD COLUMN focus_id TEXT`);
    },
  },
  {
    // The two or three questions an answer suggests asking next.
    id: "025_ask_follow_ups",
    up: (conn) => {
      conn.exec(`ALTER TABLE ask_messages ADD COLUMN follow_ups_json TEXT`);
    },
  },
  {
    // Report templates the two of you saved (lib/ask/templates.ts); the
    // built-in ones live in code. schedule_json is for running one on a
    // schedule.
    id: "026_ask_templates",
    up: (conn) => {
      conn.exec(`CREATE TABLE ask_templates (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        question      TEXT NOT NULL,
        sections_json TEXT NOT NULL,
        scope         TEXT NOT NULL CHECK (scope IN ('all','account')),
        schedule_json TEXT,
        created_by    TEXT,
        created_at    INTEGER NOT NULL,
        archived_at   TEXT
      )`);
    },
  },
  {
    // Charts an answer drew: the numbers as computed when it was written
    // (lib/ask/charts.ts).
    id: "027_ask_charts",
    up: (conn) => {
      conn.exec(`ALTER TABLE ask_messages ADD COLUMN charts_json TEXT`);
    },
  },
  {
    // A report template on a schedule (lib/ask/schedules.ts): which days,
    // what time, for whom, and when it last ran. One per template, built-in
    // or saved — the built-in ones live in code, so this cannot be a column
    // on ask_templates (whose schedule_json is left unused).
    id: "028_ask_schedules",
    up: (conn) => {
      conn.exec(`CREATE TABLE ask_schedules (
        template_id   TEXT PRIMARY KEY,
        days_json     TEXT NOT NULL,
        at            TEXT NOT NULL,
        for_user_id   TEXT NOT NULL,
        last_run_at   INTEGER,
        created_by    TEXT,
        updated_at    INTEGER NOT NULL
      )`);
    },
  },
  {
    // "Useful" or "Wrong" on an answer, with a note, so prompts and tools are
    // fixed from real misses (/ask/feedback). Never shown to the model.
    id: "029_ask_feedback",
    up: (conn) => {
      conn.exec(`ALTER TABLE ask_messages ADD COLUMN verdict TEXT CHECK (verdict IN ('useful','wrong'))`);
      conn.exec(`ALTER TABLE ask_messages ADD COLUMN verdict_note TEXT`);
      conn.exec(`ALTER TABLE ask_messages ADD COLUMN verdict_by TEXT`);
      conn.exec(`ALTER TABLE ask_messages ADD COLUMN verdict_at INTEGER`);
    },
  },
  {
    // When each person last looked at an account's research, so the brief
    // can say what changed since. `seen_at` moves on each visit after a
    // pause; `before_at` is the visit before, which is what "since you last
    // looked" means while you are still looking.
    id: "030_research_seen",
    up: (conn) => {
      conn.exec(`CREATE TABLE research_seen (
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        seen_at INTEGER NOT NULL,
        before_at INTEGER,
        PRIMARY KEY (user_id, account_id)
      )`);
    },
  },
  {
    // Attempts are durable and separate from a schedule's last successful report.
    // Existing schedules/baselines remain untouched; failed/restarted attempts
    // cannot consume the unchanged-record baseline.
    id: "031_ask_schedule_attempts",
    up: (conn) => {
      conn.exec(`CREATE TABLE ask_schedule_attempts (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        assistant_run_id TEXT NOT NULL,
        ai_run_id TEXT,
        started_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running','done','failed')),
        report_doc_id TEXT
      );
      CREATE UNIQUE INDEX idx_ask_schedule_inflight ON ask_schedule_attempts(template_id) WHERE status = 'running';
      CREATE INDEX idx_ask_schedule_attempt_time ON ask_schedule_attempts(template_id, started_at);`);
    },
  },
  {
    // The team's playbook, versioned: every save is a row (lib/playbook/store.ts).
    // Its content is the team's own and lives only here, never in the code.
    id: "032_playbooks",
    up: (conn) => {
      conn.exec(`CREATE TABLE playbooks (
        id         TEXT PRIMARY KEY,
        json       TEXT NOT NULL,
        note       TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL
      )`);
      conn.exec(`CREATE INDEX idx_playbooks_created ON playbooks(created_at DESC)`);
    },
  },
  {
    // Which playbook archetype an account is, and the hypothesis with it.
    // Set like any other account field, so its history is change_log.
    id: "033_account_archetype",
    up: (conn) => {
      conn.exec(`ALTER TABLE accounts ADD COLUMN archetype_id TEXT`);
      conn.exec(`ALTER TABLE accounts ADD COLUMN archetype_hypothesis TEXT`);
    },
  },
  {
    // Where each account is in the playbook's lifecycle. Every move is a row,
    // so time in a step and the path through the steps can be read back; a
    // checklist item is ticked once per account and step.
    id: "034_account_playbook",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE account_playbook_moves (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id),
          step_id TEXT NOT NULL,
          moved_at INTEGER NOT NULL,
          moved_by TEXT
        );
        CREATE INDEX account_playbook_moves_account ON account_playbook_moves(account_id, moved_at);
        CREATE TABLE account_playbook_checks (
          account_id TEXT NOT NULL REFERENCES accounts(id),
          step_id TEXT NOT NULL,
          item TEXT NOT NULL,
          done_at INTEGER NOT NULL,
          done_by TEXT,
          PRIMARY KEY (account_id, step_id, item)
        );
      `);
    },
  },
  {
    // The qualification scorecard: one JSON {status, evidence} per element.
    id: "035_account_qualification",
    up: (conn) => {
      for (const e of ["m", "e", "dc", "dp", "p", "i", "ch", "co"]) conn.exec(`ALTER TABLE accounts ADD COLUMN meddpicc_${e}_json TEXT`);
    },
  },
  {
    // The workshop plan per account, the roadmap phase of a play, and when
    // the customer's money is set: what the action plan is dated against.
    id: "036_workshop_roadmap",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE account_workshops (
          account_id TEXT PRIMARY KEY REFERENCES accounts(id),
          json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          updated_by TEXT
        );
        ALTER TABLE plays ADD COLUMN phase INTEGER;
        ALTER TABLE accounts ADD COLUMN fiscal_year_start_month INTEGER;
        ALTER TABLE accounts ADD COLUMN budget_calendar TEXT;
      `);
    },
  },
  {
    // Every read from and write to Salesforce, so what went where is on file.
    id: "037_salesforce_log",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE salesforce_log (
          id TEXT PRIMARY KEY,
          account_id TEXT,
          direction TEXT NOT NULL CHECK (direction IN ('check','read','write')),
          summary TEXT NOT NULL,
          payload_json TEXT,
          status TEXT NOT NULL CHECK (status IN ('done','failed')),
          error TEXT,
          user_id TEXT,
          at INTEGER NOT NULL
        );
        CREATE INDEX salesforce_log_at ON salesforce_log(at);
      `);
    },
  },
  {
    // A team of any size: who may add and remove people, each person's role
    // in the playbook, and people who have left (kept, so their name stays on
    // what they did, but unable to sign in). Everyone already here set the
    // app up, so they are its admins.
    id: "038_team",
    up: (conn) => {
      conn.exec(`
        ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN role TEXT;
        ALTER TABLE users ADD COLUMN deactivated_at INTEGER;
        UPDATE users SET is_admin = 1;
      `);
    },
  },
  {
    // More than one playbook (say, one per market), each versioned on its own
    // under a slug; the playbook there was becomes "default". An account can
    // use one that is not the team's default.
    id: "039_playbook_sets",
    up: (conn) => {
      conn.exec(`
        ALTER TABLE playbooks ADD COLUMN slug TEXT NOT NULL DEFAULT 'default';
        CREATE INDEX idx_playbooks_slug ON playbooks(slug, created_at DESC);
        ALTER TABLE accounts ADD COLUMN playbook_slug TEXT;
      `);
    },
  },
  {
    // Two more play statuses: "not applicable" and "information only", which
    // leave the plan's warnings (DECISIONS #87). SQLite cannot alter a CHECK,
    // so the table is rebuilt from its own current definition with only the
    // status list changed; nothing references plays, so nothing cascades.
    id: "040_play_statuses",
    up: (conn) => {
      const table = conn.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'plays'`).get() as { sql: string };
      const indexes = (conn.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'plays' AND sql IS NOT NULL`).all() as Array<{ sql: string }>).map((r) => r.sql);
      const oldList = "CHECK (status IN ('proposed','active','stalled','won','dropped'))";
      if (!table.sql.includes(oldList)) throw new Error("plays.status constraint is not the one this migration expects");
      const create = table.sql.replace(oldList, "CHECK (status IN ('proposed','active','stalled','won','dropped','not_applicable','info_only'))").replace(/CREATE TABLE "?plays"?/, "CREATE TABLE plays_new");
      conn.exec(create);
      conn.exec(`INSERT INTO plays_new SELECT * FROM plays`);
      conn.exec(`DROP TABLE plays`);
      conn.exec(`ALTER TABLE plays_new RENAME TO plays`);
      for (const sql of indexes) conn.exec(sql);
    },
  },
  {
    // "No next step needed" on an open deal: until a date, or informational
    // while the deal stands (DECISIONS #88).
    id: "041_next_step_waiver",
    up: (conn) => {
      conn.exec(`
        ALTER TABLE deals ADD COLUMN next_step_waived TEXT CHECK (next_step_waived IN ('until','info'));
        ALTER TABLE deals ADD COLUMN next_step_waived_until TEXT;
        ALTER TABLE deals ADD COLUMN next_step_waived_reason TEXT;
      `);
    },
  },
  {
    // The Inbox (DECISIONS #98): an accepted change can be undone, a change
    // can be edited before it is accepted (what was proposed is kept beside
    // what was applied), and an Inbox item can be put off until a day.
    id: "042_inbox",
    up: (conn) => {
      conn.exec(`
        ALTER TABLE proposals ADD COLUMN undone_at INTEGER;
        ALTER TABLE proposals ADD COLUMN undone_by TEXT;
        ALTER TABLE proposals ADD COLUMN proposed_json TEXT;
        CREATE TABLE inbox_snoozes (
          user_id    TEXT NOT NULL,
          item_key   TEXT NOT NULL,
          until_day  TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, item_key)
        );
      `);
    },
  },
  {
    // Phase 3 (DECISIONS #99): small per-person preferences (when you last
    // looked at Today, the morning digest), and each person's Slack or Teams
    // webhook, sealed with INTEGRATIONS_KEY because the URL is the password.
    id: "043_connections",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE user_prefs (
          user_id    TEXT NOT NULL,
          key        TEXT NOT NULL,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, key)
        );
        CREATE TABLE integrations (
          user_id    TEXT NOT NULL,
          kind       TEXT NOT NULL CHECK (kind IN ('slack','teams')),
          secret_enc TEXT NOT NULL,
          host       TEXT NOT NULL,
          last_ok_at INTEGER,
          last_error TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, kind)
        );
      `);
    },
  },
  {
    // The living account page (DECISIONS #100): when each person last looked
    // at an account, rolled after a pause like research_seen but kept apart
    // from it, and how often Account watch looks at each watched account.
    id: "044_account_seen",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE account_seen (
          user_id    TEXT NOT NULL,
          account_id TEXT NOT NULL,
          seen_at    INTEGER NOT NULL,
          before_at  INTEGER,
          PRIMARY KEY (user_id, account_id)
        );
        ALTER TABLE watched_accounts ADD COLUMN every_days INTEGER NOT NULL DEFAULT 7 CHECK (every_days IN (1, 3, 7, 14));
      `);
    },
  },
  {
    // Reading email (DECISIONS #102): each person's own mailbox, opted in;
    // only messages that match one account are kept, and their bodies are
    // emptied after 30 days.
    id: "045_mail",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE mail_sources (
          user_id      TEXT PRIMARY KEY,
          kind         TEXT NOT NULL CHECK (kind IN ('graph','gmail','fake')),
          mailbox      TEXT NOT NULL,
          enabled      INTEGER NOT NULL DEFAULT 1,
          last_read_at INTEGER,
          last_error   TEXT,
          skipped      INTEGER NOT NULL DEFAULT 0,
          created_at   INTEGER NOT NULL
        );
        CREATE TABLE mail_messages (
          id             TEXT PRIMARY KEY,
          user_id        TEXT NOT NULL,
          provider_id    TEXT NOT NULL,
          account_id     TEXT NOT NULL,
          thread_key     TEXT NOT NULL,
          from_addr      TEXT NOT NULL,
          from_name      TEXT,
          to_json        TEXT NOT NULL,
          subject        TEXT NOT NULL,
          received_at    INTEGER NOT NULL,
          body_text      TEXT,
          body_hash      TEXT NOT NULL,
          extracted_at   INTEGER,
          purged_at      INTEGER,
          created_at     INTEGER NOT NULL,
          UNIQUE (user_id, provider_id)
        );
        CREATE INDEX idx_mail_account ON mail_messages(account_id, received_at DESC);
        CREATE INDEX idx_mail_thread ON mail_messages(thread_key);
      `);
    },
  },
  {
    // Sending (DECISIONS #103): drafts a person reads and sends one at a
    // time, from their own mailbox; a per-person switch that allows it; and
    // a synthetic outbox the fake provider writes to in tests.
    id: "046_outbound",
    up: (conn) => {
      conn.exec(`
        ALTER TABLE mail_sources ADD COLUMN can_send INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE outbound_drafts (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          account_id  TEXT NOT NULL,
          kind        TEXT NOT NULL CHECK (kind IN ('email','invite')),
          source      TEXT NOT NULL CHECK (source IN ('recap','promise','ask','meeting','manual')),
          source_id   TEXT,
          to_json     TEXT NOT NULL,
          cc_json     TEXT NOT NULL DEFAULT '[]',
          subject     TEXT NOT NULL,
          body        TEXT NOT NULL,
          starts_at   TEXT,
          minutes     INTEGER,
          location    TEXT,
          status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','failed','unknown','discarded')),
          provider_id TEXT,
          error       TEXT,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          sent_at     INTEGER
        );
        CREATE INDEX idx_outbound_user ON outbound_drafts(user_id, status);
        CREATE TABLE fake_outbox (
          id         TEXT PRIMARY KEY,
          draft_id   TEXT NOT NULL,
          payload    TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // Written summaries (DECISIONS #106): the latest paragraph for each place
    // (Today for a person and day, an account), with the fingerprint of the
    // records it was written from. Shown only while that still matches.
    id: "047_written",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE written (
          key        TEXT PRIMARY KEY,
          input_hash TEXT NOT NULL,
          run_id     TEXT,
          json       TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  { id: "048_local_workspace", up: (conn) => { conn.exec(LOCAL_SCHEMA); } },
];

// Migration 020_contact_merge_pointer's backfill, named so it can be tested on its own. Pairs a
// contact's `merged_into` history line with the `merged_from` line on another
// contact of the same account nearest to it in time (within two seconds), and
// sets the pointer only on an archived row that has none, toward a contact
// that exists. Anything it cannot pair that way it leaves alone.
export function backfillContactMergePointers(conn: Database.Database): number {
  const losers = conn
    .prepare(`SELECT account_id, entity_id AS loser, created_at FROM change_log WHERE entity_type = 'contact' AND field = 'merged_into' ORDER BY rowid`)
    .all() as Array<{ account_id: string; loser: string; created_at: number }>;
  const keeperOf = conn.prepare(
    `SELECT entity_id FROM change_log WHERE entity_type = 'contact' AND field = 'merged_from' AND account_id = ? AND entity_id <> ?
       AND ABS(created_at - ?) <= 2000 ORDER BY ABS(created_at - ?) LIMIT 1`,
  );
  const live = conn.prepare(`SELECT 1 FROM contacts WHERE id = ? AND account_id = ?`);
  const point = conn.prepare(`UPDATE contacts SET merged_into = ? WHERE id = ? AND account_id = ? AND archived_at IS NOT NULL AND merged_into IS NULL`);
  let set = 0;
  for (const l of losers) {
    const keeper = keeperOf.pluck().get(l.account_id, l.loser, l.created_at, l.created_at) as string | undefined;
    if (keeper && live.get(keeper, l.account_id)) set += point.run(keeper, l.loser, l.account_id).changes;
  }
  return set;
}

function runMigrations(conn: Database.Database): number {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const has = conn.prepare("SELECT 1 FROM schema_migrations WHERE id = ?");
  const mark = conn.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  if (!IN_MEMORY && !has.get("048_local_workspace") && (conn.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as { n: number }).n > 0) {
    const backup = path.join(DATA_DIR, `before-local-workspace-${Date.now()}.sqlite`);
    conn.prepare("VACUUM INTO ?").run(backup);
  }
  let applied = 0;
  for (const m of MIGRATIONS) {
    if (has.get(m.id)) continue;
    conn.transaction(() => {
      m.up(conn);
      mark.run(m.id, Date.now());
    })();
    applied += 1;
  }
  return applied;
}

// The two users come from the environment and are written ONLY when the
// table is empty. Changing the env afterwards does nothing.
/**
 * The one account that is not a customer: where a todo about your own work
 * goes. Fixed id, because it is referenced by code rather than chosen by a
 * person, and a readable one so a URL naming it is obvious.
 */
export const OWN_WORK_ACCOUNT_ID = "own-work";

function seedOwnWork(conn: Database.Database) {
  const existing = conn.prepare(`SELECT id FROM accounts WHERE kind = 'own_work'`).get() as { id: string } | undefined;
  if (existing) return;
  const now = Date.now();
  conn
    .prepare(`INSERT INTO accounts (id, name, kind, created_at, updated_at) VALUES (?, ?, 'own_work', ?, ?)`)
    .run(OWN_WORK_ACCOUNT_ID, "Own work", now, now);
}

function seedUsers(conn: Database.Database) {
  const count = (conn.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0) return;
  const seeds = [1, 2]
    .map((i) => ({
      email: (process.env[`USER${i}_EMAIL`] ?? "").trim().toLowerCase(),
      password: process.env[`USER${i}_PASSWORD`] ?? "",
      name: (process.env[`USER${i}_NAME`] ?? "").trim(),
    }))
    .filter((s) => s.email && s.password);
  if (seeds.length === 0) {
    if (!IN_MEMORY) console.warn("[db] users table is empty and USER1_EMAIL/USER1_PASSWORD are not set; nobody can log in");
    return;
  }
  const now = Date.now();
  const insert = conn.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  conn.transaction(() => {
    for (const s of seeds) {
      insert.run(newId(), s.email, hashPassword(s.password), s.name || s.email.split("@")[0], now, now);
    }
  })();
  console.log(`[db] seeded ${seeds.length} user(s)`);
}

// A run still marked running when the process starts cannot be running: the
// promise that owned it died with the previous process.
export function failOrphanedRuns(conn: Database.Database) {
  conn
    // Checkpointed usage covers completed turns, not a request in flight when
    // the process died. Keep the final cost unknown so the budget retains its
    // hold; partial_cost_cents remains available in usage_json for inspection.
    .prepare(
      `UPDATE ai_runs SET status = 'failed', error = COALESCE(error, 'process restarted'), finished_at = ?
       WHERE status = 'running'`,
    )
    .run(Date.now());
  // The same for an assistant's own record of a look. A scheduled one is
  // simply due again: the scheduler counts only finished looks.
  conn
    .prepare(`UPDATE assistant_runs SET status = 'failed', error = COALESCE(error, 'process restarted'), finished_at = ? WHERE status = 'running'`)
    .run(Date.now());
}

export function initDb(): Database.Database {
  if (_db) return _db;
  if (!IN_MEMORY) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");
  const applied = runMigrations(conn);
  seedUsers(conn);
  seedOwnWork(conn);
  failOrphanedRuns(conn);
  // An Ask conversation someone chose not to keep lasts a day (lib/ask/threads.ts).
  conn.prepare(`DELETE FROM ask_threads WHERE saved = 0 AND updated_at < ?`).run(Date.now() - 24 * 60 * 60 * 1000);
  if (!IN_MEMORY) console.log(`[db] ready path=${DB_PATH} migrations_applied=${applied}`);
  _db = conn;
  g.__strategyDb = conn;
  return conn;
}

export function db(): Database.Database {
  return _db ?? g.__strategyDb ?? initDb();
}

// Tests only: throw away the in-memory database and start again.
export function resetDbForTests() {
  const conn = _db ?? g.__strategyDb;
  if (conn) conn.close();
  _db = null;
  g.__strategyDb = null;
}

export function now(): number {
  return Date.now();
}

// ---- row types ------------------------------------------------------------

export type UserRow = {
  is_admin?: number;
  /** The person's role in the playbook (its role id), or "manager". */
  role?: string | null;
  deactivated_at?: number | null;
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  failed_login_count: number;
  locked_until: number | null;
  created_at: number;
  updated_at: number;
};

export type SessionRow = { id: string; user_id: string; created_at: number; expires_at: number };

export type AccountRow = {
  archived_at?: string | null;
  id: string;
  name: string;
  crm_id: string | null;
  legal_entity: string | null;
  region: string | null;
  segment: string | null;
  hq: string | null;
  thesis: string | null;
  // Which of us runs this account. Null means both of them do — see migration
  // 009 — and every filter treats that as its own answer rather than as
  // missing data.
  owner_user_id?: string | null;
  archetype_id?: string | null;
  archetype_hypothesis?: string | null;
  meddpicc_m_json?: string | null;
  meddpicc_e_json?: string | null;
  meddpicc_dc_json?: string | null;
  meddpicc_dp_json?: string | null;
  meddpicc_p_json?: string | null;
  meddpicc_i_json?: string | null;
  meddpicc_ch_json?: string | null;
  meddpicc_co_json?: string | null;
  fiscal_year_start_month?: number | null;
  /** Which of the team's playbooks this account uses; null is the default. */
  playbook_slug?: string | null;
  budget_calendar?: string | null;
  // The account this one was merged into (migration 022), if it was.
  merged_into?: string | null;
  // 'own_work' is the single non-customer account, where a todo that is not
  // about a customer lives (migration 012). Everything else is a customer, and
  // every list that is *about* customers excludes it.
  kind?: "customer" | "own_work";
  created_at: number;
  updated_at: number;
};

export type ContactOrg = "customer" | "vendor" | "partner";

export type ContactRow = {
  archived_at?: string | null;
  /** Shared by every row that is the same human, across accounts. Null until
   *  somebody says so: nothing infers it, because a shared name is not a
   *  shared person. */
  person_id?: string | null;
  /** Set when this row was merged into another (migration 020). */
  merged_into?: string | null;
  id: string;
  account_id: string;
  name: string;
  title: string | null;
  org: ContactOrg;
  role: string | null;
  email: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export type DealStatus = "open" | "won" | "lost";

export type DealRow = {
  next_step_waived?: "until" | "info" | null;
  next_step_waived_until?: string | null;
  next_step_waived_reason?: string | null;
  archived_at?: string | null;
  // The deal this one was merged into; null for every live deal.
  merged_into?: string | null;
  deal_id: string;
  account_id: string;
  name: string;
  stage: number | null;
  stage_label: string | null;
  close_date: string | null;
  fiscal_quarter: string | null;
  tcv_usd: number | null;
  competitor: string | null;
  partner: string | null;
  architecture: string | null;
  owner: string | null;
  next_step: string | null;
  notes: string | null;
  status: DealStatus;
  created_at: number;
  updated_at: number;
};

export type InstallBaseRow = {
  archived_at?: string | null;
  // Added with archived_at in migration 013, so the row can carry a version
  // into an edit form like every other record (DECISIONS #18).
  updated_at: number;
  id: string;
  account_id: string;
  product_family: string;
  value_usd: number | null;
  share_pct: number | null;
  role_note: string | null;
  as_of: string;
  document_id: string | null;
  created_at: number;
};

export type PlayStatus = "proposed" | "active" | "stalled" | "won" | "dropped" | "not_applicable" | "info_only";

export type PlayRow = {
  archived_at?: string | null;
  phase?: number | null;
  id: string;
  account_id: string;
  title: string;
  thesis: string | null;
  status: PlayStatus;
  owner: string | null;
  next_step: string | null;
  next_step_due: string | null;
  deal_ids_json: string;
  contact_ids_json: string;
  sort_order: number;
  /** Set only by mergePlays: this row is a tombstone pointing at the survivor. */
  merged_into?: string | null;
  created_at: number;
  updated_at: number;
};

export type MeetingRow = {
  archived_at?: string | null;
  id: string;
  account_id: string;
  title: string;
  held_at: string;
  /** "HH:MM" in the app's timezone, or null when nobody said. */
  held_time?: string | null;
  attendees_json: string;
  raw_notes: string | null;
  summary: string | null;
  brief_json: string | null;
  brief_edits_json?: string | null;
  /** Set only by mergeMeetings: this row is a tombstone pointing at the survivor. */
  merged_into?: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

export type ActionItemRow = {
  notes?: string | null;
  archived_at?: string | null;
  id: string;
  account_id: string;
  meeting_id: string | null;
  play_id: string | null;
  text: string;
  // What the notes called them. owner_user_id is which of us it is, when it
  // is one of us at all.
  owner: string | null;
  owner_user_id?: string | null;
  due: string | null;
  status: "open" | "done";
  source_ref_json: string | null;
  created_at: number;
  updated_at: number;
};

export type DocumentKind = "agent_report" | "research_note" | "handoff" | "other";

export type DocumentRow = {
  id: string;
  account_id: string;
  kind: DocumentKind;
  filename: string;
  mime: string | null;
  byte_size: number;
  sha256: string | null;
  storage_path: string | null;
  content_text: string | null;
  meta_json: string | null;
  status: "draft" | "accepted";
  ai_run_id: string | null;
  created_by: string | null;
  created_at: number;
  archived_at: string | null;
  // Only a handoff has these. The token is the whole address of a shared
  // page — there is no account id in the URL — and null means it is not
  // shared, which is also what revoking a link does (migration 010).
  share_token?: string | null;
  share_expires_at?: number | null;
  // Null means the link needs no passphrase, which is what every link issued
  // before migration 011 was (and still is until it is shared again).
  share_passphrase_hash?: string | null;
};

export type ProposalOrigin = "import" | "meeting" | "plan_draft";
export type ProposalEntity = "account" | "contact" | "deal" | "install_base" | "play" | "action_item" | "meeting";
export type ProposalStatus = "pending" | "accepted" | "rejected" | "conflict";

export type ProposalRow = {
  id: string;
  account_id: string;
  batch_id: string;
  origin_kind: ProposalOrigin;
  origin_id: string | null;
  ai_run_id: string | null;
  entity_type: ProposalEntity;
  entity_id: string | null;
  op: "create" | "update";
  payload_json: string;
  before_json: string | null;
  rationale: string | null;
  source_ref_json: string | null;
  status: ProposalStatus;
  decided_by: string | null;
  decided_at: number | null;
  created_at: number;
  undone_at?: number | null;
  undone_by?: string | null;
  /** What was proposed, when the person edited it before accepting. */
  proposed_json?: string | null;
};

export type ChangeLogRow = {
  id: string;
  account_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  actor_user_id: string | null;
  proposal_id: string | null;
  source_ref_json: string | null;
  created_at: number;
};

export type AiRunRow = {
  id: string;
  account_id: string | null;
  kind: string;
  provider: string;
  model: string;
  status: "running" | "done" | "failed";
  input_summary: string | null;
  usage_json: string | null;
  cost_cents: number | null;
  error: string | null;
  result_json: string | null;
  created_by: string | null;
  started_at: number;
  finished_at: number | null;
  assistant: string | null;
};

export type AssistantRunRow = {
  id: string;
  assistant: string;
  trigger: "schedule" | "manual";
  status: "running" | "done" | "failed" | "skipped";
  summary: string | null;
  result_json: string | null;
  error: string | null;
  created_by: string | null;
  started_at: number;
  finished_at: number | null;
};

export type AssistantNoticeRow = {
  id: string;
  assistant: string;
  kind: "notify" | "question";
  account_id: string;
  action_item_id: string | null;
  for_user_id: string | null;
  text: string;
  dedupe_key: string;
  run_id: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution: "dismissed" | "answered" | null;
  subject_id: string | null;
  payload_json: string | null;
};

export type CalendarSourceRow = {
  id: string;
  kind: "ics" | "graph" | "google";
  label: string;
  owner_user_id: string | null;
  config_json: string;
  last_synced_at: number | null;
  last_error: string | null;
  last_count: number | null;
  watch_id: string | null;
  watch_secret: string | null;
  watch_expires_at: number | null;
  created_by: string | null;
  created_at: number;
  archived_at: number | null;
};

export type CalendarEventRow = {
  id: string;
  source_id: string;
  event_key: string;
  title: string;
  day: string;
  time: string | null;
  end_day: string;
  all_day: number;
  organizer_json: string | null;
  attendees_json: string;
  busy: string | null;
  cancelled: number;
  time_off: number;
  internal: number;
  account_id: string | null;
  match_reason: string | null;
  decision: "added" | "ignored" | null;
  meeting_id: string | null;
  decided_by: string | null;
  decided_at: number | null;
  removed_at: number | null;
  ack_signature: string | null;
  first_seen_at: number;
  updated_at: number;
};
