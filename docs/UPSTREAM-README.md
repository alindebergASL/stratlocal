# Strategy

> Historical upstream cloud documentation. Bedrock, Anthropic and AWS setup below are not required for StrategyLocal. Use [the local MyAgent workflow](myagent-import.md) and [Mac setup](../deploy/local/README.md).

A private workspace for two sellers to run their key accounts: a living plan
with named plays, deals with history, meeting prep and notes, on-demand
research, and reports to hand to other account teams.

Three documents describe this repository: this file (how to run it),
`STATUS.md` (what works, what does not, what is next), and `DECISIONS.md`
(the few choices that are expensive to reverse). There are no others.

## Run it locally

```sh
cp .env.example .env.local   # fill in the two users; leave the rest for now
npm install
npm run dev                  # http://localhost:3000
```

The SQLite database and uploaded documents live under `data/` (ignored by
git). The two users are seeded the first time the database is created.

Set `APP_TIMEZONE` to the zone you actually work in (default
`America/Los_Angeles`). It decides what "today" means everywhere — what is
coming up, what is overdue, the date stamped on an import or an archive, when
the fiscal quarter turns over, and when the daily AI cap resets. An
unrecognised zone falls back to the default and says so in the log.

`AI_FAKE=1` replaces every model call with canned data that matches
`tests/fixtures/agent-report.html`, so the whole flow — import, meeting notes,
briefs, research and plan drafting — can be tried without credentials. Real
calls need:

- **Amazon Bedrock** for everything that carries customer data. `AWS_REGION`
  plus credentials from the normal AWS chain (a named profile locally, the
  instance role on the server). Model access for the model in
  `BEDROCK_MODEL_ID` must be enabled in the Bedrock console for that region.
- **The Anthropic API** for web research only. `ANTHROPIC_API_KEY`. That call
  sends the customer's name, headquarters, region and confirmed web domain, the question you
  type, and nothing else from the account — its input type has no field a
  deal, a person, a meeting or the install base could go in, and a test fails
  if that file ever imports something that could reach one.

`npm run smoke:providers` sends one tiny prompt to each configured provider
and prints the model, token counts, and estimated cost.

### What a run costs

AWS bills Bedrock at its own rates and does not publish them in a form this
app can read, so none are assumed. Until you set the real rates, every cost is
derived from published list prices and is labelled "estimated" wherever it
appears. To make it exact, set the per-million-token price for the model you
use. The variable name is the model id uppercased with non-alphanumerics
replaced by underscores, so the configured Bedrock model
`us.anthropic.claude-opus-4-6-v1` becomes
`AI_PRICE_US_ANTHROPIC_CLAUDE_OPUS_4_6_V1_INPUT` and `_OUTPUT`, with optional
`_CACHE_READ` and `_CACHE_WRITE`. The name is derived from the *whole* id, so
changing `BEDROCK_MODEL_ID` changes the variable name too and a rate left under
the old one is read by nothing; `tests/priceOverrides.test.ts` is what catches
that. Note that a regional Bedrock endpoint costs
more per token than the global one, so `BEDROCK_MODEL_ID` may need a
`global.` or `us.` prefix.

A research run also pays per web search, which no token count reflects. That
rate is published, so it is the default rather than something you have to
discover: $10 per 1,000 searches, and nothing at all for a page fetch, which
pays only for the tokens it returns. `AI_PRICE_WEB_SEARCH_PER_1K_USD` and
`AI_PRICE_WEB_FETCH_PER_1K_USD` override them if your rate differs. One
caveat the figure carries deliberately: a search that errors is not billed,
but the counter counts it, so a run with a failed search over-states by a cent
— the safe direction for a cap.

## Repository privacy

Only fully synthetic examples belong in Git: names, account/deal IDs, financial
values, dates, narratives and source URLs. Renaming a real account is not enough.
Keep live evidence, exports, screenshots and mapping tables outside the worktree.
This rule also covers branch/commit text, PR descriptions/comments and CI logs.
Before publishing GitHub text, scan a draft stored outside the repository with
`node scripts/privacy-check.mjs --message-file /path/to/private-draft.txt`.

The tracked hooks check staged bytes, commit messages and newly pushed snapshots.
Install them in each clone with `npm run hooks:install`. Hooks are opt-in and can
be bypassed; CI does not prevent an initial upload. The fingerprint denylist
catches known identifiers without storing their plaintext, but cannot certify
unknown data as synthetic. Review changes manually before every commit or post.
`npm run privacy:history` audits reachable historical objects; a clean working
tree does not erase old commits, PR diffs, edit histories, forks or caches.
History rewrites need owner approval. Production customer records are separate
from this boundary and must not be changed as part of repository cleanup.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run privacy     # known identifiers/artifacts; manual review is also required
npm run privacy:staged
npm run hooks:install # enable pre-commit, commit-message and pre-push checks
```

All of it, and the browser flows below, run in GitHub Actions on every push
(`.github/workflows/ci.yml`). Nothing there needs a secret: the tests make
their own in-memory database and the flows seed their own users and force
`AI_FAKE=1`, so no provider is ever called.

Those cover the logic. What they cannot cover is whether the app works — a
save that persists, a proposal that applies, a page that does not scroll
sideways on a phone. That is `e2e/`:

```sh
npm run e2e                  # every flow
npm run e2e -- two-people    # just one
```

It builds, starts the standalone server against a throwaway database with
`AI_FAKE=1` and two seeded users of its own, runs each flow against a fresh
database, and stops the server afterwards. Nothing is needed in `.env.local`
and no model is called.

The browser is the one thing it cannot bring: `npx playwright install
chromium` once, or set `PLAYWRIGHT_CHROMIUM_PATH` to one the machine already
has (which is what you want when the container ships its own build).
Playwright itself is a devDependency, so `npm install` is enough.

### How heavy a page is

The flows above own the *budgets*, at the volume they build. The numbers
STATUS quotes are a different thing — what a page weighs at a year of use —
and they come from a command rather than from somebody measuring by hand once:

```sh
DB_PATH=/tmp/fixture.sqlite npx tsx scripts/load-fixture.mts
npm run build
DB_PATH=/tmp/fixture.sqlite npm run measure
```

Fifteen accounts, 600 deals, 450 meetings and 60 research notes of fifty
findings each, then bytes and milliseconds for the six pages that grow with
use. The fixture is synthetic throughout and writes only to the `DB_PATH` you
name — it refuses to run without one, because the default is probably the
database you are using.

The flows:

| | |
|---|---|
| `import-and-review` | a report becomes proposals, nothing changes until someone accepts, and importing it twice changes nothing |
| `deal-merge` | a deal added before the CRM had an id for it, duplicated by the report, merged the right way round — and the report cannot bring the duplicate back; then two spellings of one owner, suggested, confirmed, and one entry in the pipeline filter |
| `person-merge` | two rows for one human, the duplicate on a play and in a meeting, and both on the survivor afterwards |
| `two-people` | both of them editing one record: disjoint fields go through, the same field is refused with what changed and who, and Save anyway works; then the team direction written by one, read back, and the other's stale edit refused |
| `meeting-notes` | the same collision on the one field history cannot undo, including Keep both |
| `invite` | a pasted invite fills the form, with the time converted into ours, the known attendee ticked and the unknown one named but not created |
| `follow-ups` | one written down by hand reaches the account, my list and Home, and not my partner's |
| `review` | the weekly walk: filter to a quarter, slip a date and a value from the list, a person's page, and the same report imported twice under two dates |
| `record-merge` | two rows for one play and two records of one call, merged from the record's own page: the links only one row carried, both halves of the notes, a tombstone that does not offer Restore — and the meeting merge undone from the account page, each record with its own notes again |
| `ownership` | an account says whose it is, and the three pages that filter on it answer from their own links |
| `spreadsheet` | a CRM export read without a model: the mapping is confirmed before anything is proposed, and a version that quietly applied the guess would fail here |
| `handoff` | a stranger with no session can read the link while it is live and cannot the moment it is ended |
| `research` | from the button to a finding that survives review: what is ticked is what is stored, under fake AI with the real guards |
| `research-workflow` | research as a person walks it — findable on the account, readable on its page, and a suggestion the evidence does not support is withheld while its siblings stay reviewable |
| `ux-recovery` | the connection drops after a decision reached the server: the screen says it does not know, locks the decision, and a read of the record settles it |
| `useful-brief` | a brief's proposed next step becomes a follow-up only through confirmation, with its evidence, and pressing twice makes one |
| `partner-freshness` | two sessions on one account: one saves, the other is told quietly, nothing reloads itself, and a half-written draft survives the refresh |
| `post-meeting` | notes, review, explicit accept and reject, follow-ups created on the meeting, the counts that result, the one-card deck accepting every card in the database, and the recap draft changing nothing |
| `dogfood-handoffs` | the three things task-first use found: a meeting-created follow-up belongs to the meeting, a long proposed value is readable, an assigned-but-undated task says so |
| `planning-workspace` | a title-only task captured with no account, found again, connected later, and prepared beside the meeting it is for |
| `assistants` | a customer promise with no date asked about once and answered by dating the follow-up, an assistant switched to run on its own, a budget that does not fit refused, and the scheduler's secret-guarded door |
| `calendar` | a published iCal link read in, a matched customer meeting added in one tap with its contact, an unknown one assigned, an internal one skipped, a day off shown, and a moved invite moving its meeting |
| `account-watch` | an account watched from its research page, one look started with Run now and paid from the watch's budget, the note marked against the plays, carried on Today as one item and cleared by keeping it |
| `plan-keeper` | a play whose next step slipped asked about once, answered from Today's check-in as the person's own edit, and shown as it now stands on the plan page, on a phone too |
| `handoff-writer` | a follow-up falling in typed days away listed and cited by a drafted cover note, handed to the other person in one press, and an account handoff whose draft fills the form the person then edits and creates |
| `first-glance` | Today and the account rail name one thing to do and say why, on a desktop and on a phone |
| `layout-slice` | the layout regressions: section hierarchy, research columns, the deal table's narrow-screen scroller |
| `type-usability` | typography and modal regressions, read-only |
| `weight` | no page ships a list it says it is not showing, and none is an order of magnitude heavier than it should be |
| `widths` | every route at 390, 768 and 1440 pixels, `/login` included |

They address forms by `data-testid` rather than by their words, because every
one of them has broken on copy changes that were deliberate improvements.

## Nothing is deleted

Records are archived, never removed. An archived account, deal, contact, play,
meeting, follow-up, uploaded report or research note disappears from every
list, from search, and from anything the model reads, and anything still
proposed for it is rejected. Its history
survives and it can be restored from the Archived block at the foot of the
account page, or of the home page for an account. Archiving is a person's
decision: a proposal may restore a record the model still sees evidence for,
but it can never archive one.

## How changes happen

Every row change goes through one function, whether a person typed it or the
model proposed it. Model output never touches a row directly: an import or an
extraction produces proposals, a person accepts or rejects each one, and the
accepted ones are applied with one history line per changed field. Rejected
proposals are remembered so the same suggestion is not made twice.

## Layout

```
app/          pages and route handlers (App Router)
components/   the visual vocabulary and small UI pieces
lib/          db, auth, clock, fiscal calendar, money, tone, documents,
              proposals, ai/, import/, sheet/, meetings/, research/, plan/,
              handoff/, queries/, setup
tests/        vitest; tests/fixtures is synthetic data only
scripts/      smoke-providers, backup, load-fixture, privacy-check
e2e/          browser flows, run against a real build
deploy/       Dockerfile, compose, Caddy, and the runbook
.github/      the checks, on every push
```

## How it looks

One theme in `app/globals.css`: colour, type and spacing tokens, semantic
colours in threes (text, soft ground, border), and a type scale with room
above body size. `components/ui.tsx` is the vocabulary — buttons, controls,
cards, callouts, chips, headers — and everything in it carries a focus ring,
so keyboard use works by default rather than by remembering. `lib/tone.ts` is
the only place that decides what colour a status is.

Two families, both self-hosted at build time so a running instance never calls
out for a font: Archivo for display and Inter for everything else, with
tabular figures wherever money or dates line up in a column. The palette is a
warm off-white paper and graphite ink with a single teal accent; a model's
confidence is never shown in the colour that means success, and the status
colours are reserved for things that are actually a status.

⌘K jumps to any account.

## When two of you share it

An account can say which of you runs it — or neither, which is the default and
a real answer for one you work together. Today, Accounts, the pipeline, what
moved and `/activity` can each be asked for yours, theirs or the shared ones, and the
filter goes into the query rather than being reapplied per screen, so the
counts on a page describe the rows underneath them.

`/activity` is the answer to "what did my partner change while I was away":
the history across every account or one of them, over a day, three days, a
week or a month, grouped by day and naming who. Accepted proposals collapse
to one row per batch, so an import is a line rather than a hundred and
seventy.

Nothing on a page changes by itself. When the other one of you saves
something on an account you have open, you are told quietly and offered a
Refresh — never refreshed, because a screen that replaces itself under your
hands while you type is worse than one that is a day stale. The refresh is
deferred when taking it would close an editor you have open, and what is
half-written survives it.

A save cannot quietly overwrite theirs either. Every edit form carries the
version of the row it was rendered with, and a save is refused when the
other one has since changed a field this save would also change, naming the
field, what it holds now and who put it there. Only on a real overlap:
correcting the notes does not block someone setting a next step. A meeting's
notes are the one collision history cannot undo, so those get three exits:
**Keep mine**, **Keep both**, and **Keep theirs**, which adopts their saved
text into your editor without writing anything.

`/follow-ups` is the other half of that: everything open across every
account, split into mine, theirs and nobody's.

## Handing an account over

`/accounts/[id]/summary` is the account on one page with nothing on it you can
press: thesis, plays, open deals by quarter, people, follow-ups, install base,
accepted research with its sources, and recent meetings. It has a print
stylesheet, so the browser's own Save as PDF produces a document — no
navigation, no controls, black on white, and no card broken across a page
boundary. Reach it from **One page** in the account header.

## Getting things out

`/pipeline` also answers the other half of a weekly review. The list is what is
true now; **What moved** is what changed since last week, read out of the record
of every change rather than from a snapshot table — pushed out of a quarter,
pulled in, stage and value moves, won and lost, and the open deals closing this
quarter that nothing has touched at all. Each row says whether one of you
decided it or a report import restated it.

`/pipeline` has **Export CSV**, which carries whatever filters are set, and each
account offers its deals, its people and its open follow-ups the same way. Raw
values rather than what the screen shows, so a money column sums — and a cell
that would be a formula in Excel is defused before it gets there.

A CSV can also come the other way: `/accounts/[id]/import-sheet` reads a CRM
export of deals, or a list of people, with no model call at all. A spreadsheet
has a header row, so the only judgement needed is what the file is and which
column is which — and that is yours, confirmed before anything is proposed,
because a confident wrong guess would write a close date into the value column
across the whole pipeline, and a file of people read as deals would propose a
pipeline named after colleagues. From there it is the path an imported report
takes: proposals, one review screen, one write path.

The two kinds are matched differently, because they have to be. A deal is
matched on its CRM id and nothing else: matching by name would let a rename in
the CRM overwrite an unrelated deal, and a deal carries money. A person has no
id in any export, so it is the email address and then the name — the rule in
`lib/matchContact.ts`, shared with the report import so the two cannot drift.
Somebody the file does not match becomes a new person at the customer, unless a
column says otherwise.

`/accounts/[id]/summary` is the other direction: a document rather than a
table, read-only and printable. `/accounts/[id]/handoff` goes further — a
snapshot of the account with an ask at the top, stored so it does not change
afterwards, on a link somebody without a login can open. That link has an
expiry you choose, can be ended immediately, and gives a new address if you
share it again; the screen that hands it to you says plainly that anyone
holding it can read it.

## How fast it is

`scripts/load-fixture.mts` writes a database the size this is actually for —
fifteen accounts, 600 deals, 450 meetings, 120 plays, 12,865 history rows, all
fictional — and `npm run measure` reads every page against it, round-trip over
HTTP:

```sh
npm run build
DB_PATH=/tmp/load.sqlite npx tsx scripts/load-fixture.mts
DB_PATH=/tmp/load.sqlite npm run measure
```

Measured after the overhaul's first phase: Today 47 KB in 28 ms (it was 108 KB
while it also carried the account table and the activity feed), `/accounts`
59 KB, the backlog sorter 58 KB, the pipeline 355 KB in 54 ms, `/activity` over
thirty days 326 KB, an account page 303 KB, its research 147 KB, a play 73 KB,
a meeting 68 KB, a task 45 KB, `/follow-ups` 41 KB. The pipeline is the
heaviest — every row carries a link saying where its next step stands. These
are the documented numbers because they come from a command; `STATUS.md`
quotes the same run.
`npm run e2e` holds the budgets separately, at the smaller volume its flows
build, and its `weight` flow fails when a list starts shipping rows it claims
not to be showing.

## Deploy

One small EC2 instance, Docker Compose, Caddy for the certificate and the
security headers, a nightly snapshot to S3. The runbook is
[`deploy/README.md`](deploy/README.md) — including why the backup uses
`VACUUM INTO` rather than copying the database file, which restores something
with no tables in it.

It has not been run against real AWS yet. **Check providers** on Home is the
first thing to press once credentials exist — `npm run smoke:providers` is the
same check for local development, and cannot run in the image, which has no
`tsx`.
