# Status

Updated: 2026-10-26 (Phase 8: the Writer; Phase 9: ready to go live, with mail and backup checks and the release checklist). What works, what does not, what is next. Keep it under a page.

## What works

- **Sign in, for a team of any size.** The first one or two people come from
  the environment as admins; admins add everyone else under Settings, Team,
  set their roles, and turn off someone who has left. Cookie session, lockout
  after repeated failures. The app's name, team name, logo and deck colour
  are set there too.
- **The team's playbook** (`/settings/playbook`), imported from the team's
  own document or started from the neutral starter, edited in the app with
  its history, and moved between teams as a file or inside a **team pack**
  (`/settings/team`; the neutral one is `starter/team-pack.json`). Every
  account gets a **Playbook** tab: its archetype and hypothesis (suggested,
  accepted, dated), where it is in the lifecycle with checklists and the next
  thing to do (also on the Overview and in the header), the MEDDPICC
  scorecard filled from meeting notes as proposals, with Copy for Salesforce,
  a workshop planner that places each use case by the playbook's rubric, the
  roadmap in three phases and a Mutual Action Plan dated against the
  customer's fiscal year (downloadable as a calendar file). Meetings get the
  playbook's questions for who is in the room; Ask has templates for what
  each step produces and a playbook tool; any report downloads as a
  PowerPoint deck. The Quarterly refresh assistant (off by default) re-asks
  the archetype and lists what to re-check. A team can keep **more than one
  playbook**, one the default, each account using its own. With a playbook,
  research also looks for **budget timing** (a fixed ask; none of the
  playbook's wording leaves) and proposes the fiscal year it finds. The
  playbook page shows **win and loss by archetype** as each account was when
  its deal closed, and the placement rubric's scores are editable.
- **Salesforce, optional** (`/settings/salesforce`): off until turned on and
  given credentials in the environment (REST or an MCP server). Reads arrive
  as proposals; the scorecard is written to an opportunity only on a press,
  after its preview. Every read and write is logged.
- **Today.** A greeting, one counted sentence about the day, and then three
  things: **Next up** (one named thing with the reason it was chosen: today's
  meeting if there is one, else what is past due or due today, else what is
  waiting for review, else the next meeting, else the last one with no notes),
  **at most five** other things to clear, and your own tasks. The five are
  picked by a fixed rule printed under "How these were picked": preparation
  for today's and tomorrow's meetings, then what is due today, then what
  slipped in the last week (most recent first), then reviews, then meetings
  with no notes, then what the other one of you changed in the last day. Not
  a score — a recommendation nobody can see the grounds for is a guess.
  Anything more than a week past due is one line, "N older follow-ups past
  due", with a way to **sort them in one sitting** (`/follow-ups/sort`: one
  card at a time — done, a new date, or let go, which archives). Every other
  count is a quiet link at the foot of the page to its complete list. The
  sentence and the counts are computed, never written by a model.
- **Navigation is a quiet sidebar** on a wide screen and the familiar bar on
  a phone. **Accounts** has its own page (`/accounts`) — the table, the
  owner filter, the quiet-account warning, new and archived accounts — where
  it used to be the bottom half of Today. Section headings across the app are
  labels with a hairline now rather than shaded bars. ⌘K jumps to any account
  from anywhere.
- **After a meeting, one card at a time.** Extracted changes are dealt as
  cards: the consequential ones (a stage, money, a status) one each, new
  people as one card, new follow-ups as another, with the sentence from the
  notes under each. "Accept the rest" takes only people, follow-ups, dates
  and the summary; everything else is decided on its own card. The old list
  is one tap away under "All at once". A **recap email** is drafted from the
  same notes on request — every line traceable to what you wrote, gaps left
  in brackets, nothing sent from the app. The meeting's follow-ups open with
  **what you owe them and what they owe you**.
- **Assistants start on their own** (`/assistants`). A loop in the compose
  file knocks every five minutes; each assistant is Off, When I ask, or On
  its own. **Promise keeper** reads follow-ups (no AI, no cost): a reminder
  two days before something you promised is due, a notice when a customer's
  promise is, and a question when a customer promised something with no
  date, answered one card at a time on `/promises`. **Meeting prep** writes
  the brief for a meeting that has none, never over one you edited. Today
  carries what they left within its five, and one line saying what they did.
  Money nests: a monthly total, the daily cap, each assistant's own limit,
  and your share for everything you press. Nothing an assistant does changes
  a record.
- **Handoff writer.** `/handoff` is cover while you are away: from your own
  calendar's time off (or typed dates), your dated follow-ups — handed to
  the other person in one press — the meetings on your accounts, customer
  promises and play steps due, and a drafted note for whoever covers. Today
  says "You are off …" a week ahead. On an account's handoff page, "Draft it
  for me" fills in what you are asking for; you edit and create it.
- **The plan as a page** (`/accounts/<id>/plan`), and **Plan keeper**: it
  asks about plays whose next step slipped, active plays with none, and
  plays quiet for 30 days, and once a month per account reads the thesis
  against recent meeting notes, quoting both. Answered one card at a time on
  `/plans` or the plan page, as ordinary edits. It never rewrites the plan.
- **Account watch.** Choose accounts to watch (on an account's research
  page, or on /assistants) and it looks for public news about each once a
  week, from its own budget, leaving a research note to keep or drop. Only
  what is new: nothing shown before, nothing older than 60 days. Findings
  that share words with a play are marked and ticked first. Today carries
  waiting notes as one item.
- **Calendars** (`/calendar`). A published iCal link from Outlook or Google
  works with nothing set up; Strategy's own Outlook mailbox and a shared
  Google calendar work once their credentials are on the box. Events are
  matched to accounts by who is invited, internal ones skipped, and the
  customer meetings offered as "Add N meetings" — one tap, with the invited
  contacts as attendees. Unknown ones ask "Which account?". A moved or
  cancelled invite offers to move or archive its meeting. Time off on a
  person's own calendar shows on /calendar, and the other person's coming
  week on Today. Nothing is written to any calendar.
- **It works on a phone.** Every screen, at 390 pixels, with no sideways
  scrolling — checked mechanically by the `widths` flow in `e2e/`. The meeting
  page leads with whichever of its parts needs you: the brief before the call,
  the review once extraction has proposed something, the notes when there are
  none, the follow-ups after — which is what you actually want standing in a
  car park.
- **Deals have their own page**: every field editable, readable history, the
  plays that cover it, the meetings that moved it, anything still proposed for
  it.
- **Accounts, contacts, deals, plays** can be added and edited by hand. Every
  edit writes one history line per field, and a form only writes the fields it
  actually rendered — an absent input means "this form does not edit that",
  never "clear it".
- **The two of you cannot overwrite each other silently.** Every edit form
  carries the row version it was rendered with, and a save is refused when the
  other one has since changed a field this save would also change — naming the
  field, what it holds now and who put it there, with Save anyway when the
  answer is "mine, I know". Only on a real overlap: someone correcting the
  notes does not block you setting a next step. A meeting's notes are the one
  collision history cannot undo — it keeps their size, not their text — so
  those get three exits rather than two: Keep mine overwrites, Keep both puts
  the halves in one document under a line saying whose is whose, and **Keep
  theirs** adopts the other one's saved text into your editor without writing
  anything. Theirs is offered only when the text shown is the exact version
  your save was refused against; a third write in between withholds it and
  says how to retry.
- **You are told when the account has moved under you, and nothing moves on
  its own.** A page that is open while the other one of you saves something
  on that account shows a quiet notice and an explicit **Refresh**. No page
  ever reloads itself, and the refresh is deferred — and says so — when taking
  it would close an editor you have open or discard a decision whose outcome
  is not yet known. What is half-written survives the refresh, and so does
  the version it was written against. Scoped to the overview and the record
  pages; research, review and import deliberately did not get a control that
  could replace what is on screen.
- **What changed while you were away.** `/activity` reads change_log across
  every account, by day, over one to thirty days, naming who made each change
  — and saying so plainly when it was both of you — and what each field moved
  from and to, not only which fields moved.
- **A deal id can be left blank.** It is the CRM opportunity id, and you often
  do not have one yet; the app issues a local one and says "no CRM id yet"
  wherever the id would go. When the report arrives with the real id, the two
  rows merge: plays relink, the blank text fields fill, the history follows
  without being rewritten, and the money is never moved by an identity
  operation. The merge refuses to keep the local id over the CRM one, because
  the import reads archived rows and would otherwise propose bringing the
  duplicate back on every future report.
- **Fiscal quarter** is derived from a deal's close date (fiscal year start
  month is configuration) and is editable per deal.
- **Pipeline** lists deals across accounts grouped by fiscal quarter,
  filterable by status, stage, owner, quarter and account, fifteen per quarter
  with a link to the rest. A weekly review happens on that one page: the quick edit on
  each row carries the next step, the stage, the status, the close date and the
  value, and reads "1.2M" the way it gets said out loud. Each row also says
  where its next step stands — written and not yet a follow-up, linked to open
  follow-ups, or only on record — read from provenance rather than guessed
  from a task's wording, and the owner the CRM wrote stays a different thing
  from the person one of you assigned. **Export CSV** takes the filters with
  it.
- **It is quick at the size it is for.** `npm run measure` against the
  committed fixture (`scripts/load-fixture.mts`: fifteen accounts, 600 deals,
  450 meetings, 60 research notes of fifty findings, 12,865 history rows) —
  round-trip over HTTP, so these are a shade slower than a render:

  ```
  /                               47 KB    28 ms
  /accounts                       59 KB    36 ms
  /follow-ups/sort                58 KB    23 ms
  /pipeline                      355 KB    54 ms
  /activity?days=30              326 KB    57 ms
  /follow-ups                     41 KB    13 ms
  /accounts/<id>                 303 KB    58 ms
  /accounts/<id>/research        147 KB    39 ms
  /accounts/<id>/install-base    104 KB    24 ms
  /accounts/<id>/plays/<id>       73 KB    22 ms
  /accounts/<id>/meetings/<id>    68 KB    19 ms
  /follow-ups/<taskId>            45 KB    15 ms
  ```

  These are the documented numbers and they come from a command, because the
  last set was measured by hand and went wrong the moment the fixture changed
  underneath them. `npm run e2e` owns the budgets instead, at the smaller
  volume that flow builds, and its assertion that bites is not the byte count
  but that a capped list does not contain the rows it says it is hiding —
  uncapping the meetings list again cost 5 KB, passed the budget, and failed
  that check at once.
- **Import an account plan report** (HTML exported from the sales tool).
  The file is stored with the account, read into text, and the model fills a
  fixed schema. Deal ids the report text does not contain are dropped before
  anything is shown. Differences from the account become proposals: account
  metadata, seller team as contacts, deals by id, an install-base snapshot
  dated to the report rather than to the upload, and plays.
- **Meetings.** A meeting records its date and attendees, and holds the raw
  notes you paste in. Notes are stored as a document: they go through the same
  write path, but history records their size rather than a second copy.
- **Notes become reviewable changes.** Extraction updates deals, plays and
  known contacts, and creates only two things: people the account has not met
  and follow-ups the notes commit to. Two guards run in code, not on the
  model's word: an id it cites must be one we gave it, and a quote it claims
  must appear in the notes. Anything failing either is fed back once and then
  dropped. Accepted changes carry the quote into the record's history.
- **Pre-meeting brief.** The top of the meeting page is the short version —
  the purpose, up to three cited facts, a hypothesis labelled as one, the
  questions, how this connects to the account or an honest gap, the proposed
  next step and what is uncertain — selected from what the stored brief
  already says, never invented for a brief that has none, with the full
  sections one disclosure away. Every line except a question cites a record,
  each citation resolves to a name and links to it — a research finding to
  the exact sentence — and a brief citing anything we did not supply is
  rejected rather than shown. The proposed next step becomes a follow-up only
  through the proposal path, after you have edited the text and chosen an
  owner and a date: it keeps its AI origin and its evidence, re-checks that
  evidence at the moment of accepting, and pressing twice does not make two.
  Where the text was rewritten — in the form, or in an edited preparation —
  the review card says the wording is the person's and quotes the model's
  words beside it, rather than calling a sentence a person wrote "not a
  user-authored statement".
  You can edit the preparation by hand; the complete original brief stays
  beside the edit, labelled, and regenerating asks before replacing it.
- **Follow-ups** can be written down by hand — text, a date, whose it is,
  which play it belongs to, and notes — as well as arriving from a meeting's
  notes with the quote that produced them. One typed on a meeting belongs to
  that meeting, bound on the server rather than by whatever the form happened
  to carry. Ticking one done or open carries the row as the box was drawn, so
  a tab left open since yesterday cannot quietly reopen what the other of you
  closed this morning. **A thought can be captured with no account at all**: a
  title-only task lands in `Own work`, has its own page, shows on the Tasks
  views, and can be connected to an account or a meeting later keeping its id
  and its history — but only standalone own work ever moves; anything that
  came from a source keeps its original account and its evidence. **Work that
  is not about a customer** has a home too: `Own work` is the one account
  flagged as not-a-customer, always offered on `/follow-ups` even when empty,
  so "build the forecast" has somewhere to go. It is excluded from every list that is about customers, and
  its own account page sends you to the todos rather than showing a column of
  empty sections. `/follow-ups` is everything open across every
  account, split into mine, theirs and nobody's, with the undated ones flagged
  because nothing else in the app will ever remind you about those. Writing
  one down is the page's primary action, in the header, and it opens the Own
  work list — a todo typed there without naming a customer is by definition
  not about one. Ticking one is instant and independent of the others, and
  "mark all N done" clears what a call left behind in one go.
- **The pipeline has a memory.** `/pipeline` is what is true now;
  **What moved** is what changed since last week, read from the record of
  every change rather than from a snapshot table. What was pushed out of a
  quarter and what was pulled in — compared as quarters, so a two-day nudge is
  not called a slip — what changed stage or value and by how much, what was won
  and lost, and the inverse nobody else asks: the open deals closing this
  quarter that **nothing** has touched. Each row says whether one of you
  decided it or a report import restated it, because "twelve deals slipped" is
  often really "the export ran on Tuesday".
- **Won and lost are reachable.** The pipeline can be asked for them, and the
  CSV follows. Marking a deal won used to remove it from the only
  cross-account view of a deal there is.
- **A next step can become a commitment, and only by saying so.** A deal's or
  a play's written next step can be turned into a follow-up through a
  confirmation that keeps the text editable and makes you choose an assignee
  or unassigned, and a date or no date. The source text is never changed by
  the act. The record's id is derived from the account, the source and the
  exact next step, in an immediate transaction, so pressing twice — or both of
  you pressing at once — finds the one record; a next step that has changed
  since the draft was opened is refused rather than silently filed under the
  old words. A follow-up shows its source separately from whatever play it
  happens to be on now, and a missing, archived or merged source is labelled
  rather than replaced with a guess.
- **An unknown outcome is not a success, and not a refusal either.** When the
  reply to a decision never arrives, or arrives without an outcome the screen
  can read, the write may well have happened — in the case this was found in,
  it had. The screen used to say "Nothing was applied", which was a claim it
  could not support and an invitation to press Accept again. Now it says it
  does not know, locks that one decision, and offers the only thing that
  settles it: a read of the server's own record. Only an explicit status ever
  reports a decision, and the read settles every status a proposal can hold —
  the audit of the month found it accepted three of the four, so a conflict
  the server recorded after a lost reply stayed unknown for good, and the hold
  it placed on the account's Refresh stayed with it. A dropped connection on
  an ordinary save keeps what you typed and says the save may or may not have
  landed; it never says "nothing was saved", which on a create form is the
  sentence that makes a second copy. Accept all names the rows it was pressed
  over, by id, so a proposal that arrives after the list was drawn is not
  applied by a button that never showed it. The route's contract: a list is
  required and is honoured exactly; an id in it that is no longer pending —
  the other of you decided it while the list was open — is left out and
  reported by its absence, never a reason to refuse the rest. A request with
  no list, or one that cannot be read, is refused before anything is
  written: it used to fall back to "everything pending on the account", and
  a selection of 420 was too large to read, so it accepted 421.
- **A proposal is checked against what the model saw.** A run captures the
  account before the model reads it, and its proposals are compared with
  that at accept time — so a deal moved to stage 6 while extraction ran makes
  the model's "stage 4" a conflict, where it used to be accepted. A proposal
  for a record archived or merged since it was filed is a conflict too.
  Extracting the same notes twice does not propose a follow-up the meeting
  already has or already has pending; regenerating a plan files its
  suggestions again rather than treating the superseded draft as a refusal.
- **The account page leads with work.** Meetings, then Follow-ups, then Plan,
  with Research a second column on a desktop and after the work on a phone;
  Deals, People, Install base, Documents and Account details are disclosures
  below, each with its add form and its anchor kept. The rail names the next
  meeting and what is pending. Three competing copies of the account's
  identity and section pills are gone.
- **Two accounts for one customer can be merged, and unmerged.** From the
  account's Details, another account is merged in: its records move here
  through the one move function, blank fields here are filled from it, and it
  is archived and points here, so its links land here. What is not carried
  (an install-base line for a date this account already has, a second thesis)
  and people with the same name on both are said before the press. Undo puts
  back what has not been tied to this account since and names the rest.
- **A merge says what it will do before you press it.** For a play or a
  meeting the form names what *these two records* would do to each other —
  what it brings, what it fills, what it archives, what it will not carry —
  from the same planner the merge then applies, so the sentence cannot drift
  from the behaviour. A pair the guards would refuse says so before the press
  rather than as a red line after it. And the meeting picker says how much it
  actually knows about each candidate: shared attendees, near enough the same
  title, or nothing in common but the day — because two different meetings on
  one day is ordinary, and that offer must not look like the others.
- **Two rows for one record can be merged** — a person, a deal, a play or a
  meeting. Whatever pointed at the row that loses is relinked, the keeper's
  blank fields are filled from it, anything still proposed for it is rejected,
  and it is archived rather than deleted. A play's deals and people and a
  meeting's attendees become the *union* of both rows, because each was
  written by somebody who knew something the other did not. Two sets of
  meeting notes are kept, both halves in one record under a line saying which
  came from where; a brief is not merged, because it is a dated document and
  the merge says so rather than leaving you to notice. All of it is in
  history. Two things the release review of this code found and its author
  had not: the union holds when the keeper's own list already repeats an
  entry, and a follow-up still proposed against a row that has since been
  merged lands on the survivor at the moment it is written, with its
  provenance intact.
- **A merge can be undone.** Every merge leaves a receipt: the before and
  after of every column it changed on every row it could touch, kept in the
  same transaction. The account page lists the merges that can be undone,
  each saying what undoing it would do; undoing puts back every field nothing
  has written to since, brings the other record back as its own (unless it
  was already archived before the merge), puts the proposals it rejected back
  up for review, and writes history on both records. Anything changed since —
  even back to the same value, by either of you or by a later merge — stays
  as it is and is named; a record moved to another account since is left
  alone. If anything changes between the page being drawn and the press, the
  undo is refused and the page re-read, so what you were shown is what
  happened. Not on an archived account. An independent read of the first
  version found six ways it could fall short of this; each is now a test.
  Merges made before receipts were kept have none, and are not offered.
- **A deal owner is one person however the CRM spells them.** The report
  writes the owner as text, so "Jamie", "Jamie L." and "Jamie Lee" arrive as
  three. `/pipeline/owners` says which spellings are one name: it suggests
  the pairs it can see are almost certainly one person — never a short name
  that fits two — and a person confirms each. The pipeline's filter offers
  one entry per person and finds every spelling of them; its rows and the
  account's deal list show the confirmed name. The deals keep exactly what
  the report wrote, so the next import has nothing to fight.
- **A merged-away row is a tombstone, not an archived one.** It says where it
  went instead of offering Restore, and it is gone from the Archived block:
  restoring one would return a play whose follow-ups now answer to the keeper,
  or a deal whose plays have been relinked. A merged-away play is also
  followed to its survivor by the report import and the plan draft, which
  match a play by title against archived rows — without that, one Accept all
  would bring the duplicate back on every import, forever. A merged-away
  person is a tombstone too, from migration 020: before it, importing their
  old name again proposed restoring them, and one Accept undid the merge.
  Merges made before it were pointed from their history lines where the pair
  could be found.
- **The same human at two accounts can be related.** Each account keeps its
  own row; the link only says they are the same person, and never leaves the
  screen — not into a prompt, not into a handoff.
- **A deal can be moved to another account**, keeping its id, its history and
  anything proposed for it; plays on the account it left are unlinked.
- **Every record has a page.** A deal, a person and a play: what it turns
  on as links, the meetings that moved it, its history, and its edit form. The
  account page reads and links; it does not also edit, which is what made it
  the heaviest screen in the app.
- **Paste the invite instead of typing the meeting in.** The subject, the
  date, the time and whoever is listed as attending, read into the New meeting
  form — and nothing is saved until you press Create, so a bad read costs
  nothing. Two guards run in code: an attendee must be quotable from the paste,
  and the time is converted from the zone the invite names by the app rather
  than by the model, which is told not to. A zone it does not recognise leaves
  the time exactly as written and says so, because a meeting filed an hour out
  is worse than one with no time at all.
- **A meeting knows what time it is.** Optional, because a meeting genuinely
  can be "some time Thursday" — but given one, "Coming up" orders the day by
  it instead of alphabetically by account, and "happened, no notes yet" asks
  in the hour after the call rather than the next morning.
- **A person has a page.** `/accounts/[id]/contacts/[contactId]`: every meeting
  they were in with whatever was written beside their name that day, the plays
  they are on, the deals those plays touch, follow-ups standing in their name,
  and their history. This is the screen to open before a call with someone you
  have met before.
- **The install base has a trend, and can be corrected.** Snapshots are kept
  per report date; the account page shows what moved against the one before, in
  value and in share, and marks a product family the latest report stopped
  mentioning rather than dropping it. It was the one record nothing could touch
  by hand, so a figure misread from a report table was permanent — now a line
  can be written down, corrected or archived on `/accounts/[id]/install-base`,
  which is also the only place every stored snapshot is visible rather than the
  newest two. Re-importing a corrected report for a date already on file
  proposes the difference instead of being skipped.
- **An account on one page.** `/accounts/[id]/summary` is read-only, with no
  control on it, and prints: the browser's own Save as PDF produces a document
  you can send to another account team.
- **Whose account it is.** An account can name which of you runs it, or
  neither — sharing one is a real answer and the default. Today, Accounts, the
  pipeline, what moved and `/activity` can each be asked for yours, theirs or the shared
  ones, and the filter is one clause in the query rather than a rule each
  screen reapplies, so the counts and totals describe the rows underneath
  them. Handing an account over is a dated line in its history like any other
  change.
- **Import a spreadsheet.** A CSV of deals from the CRM, of people, or of an
  install base, read without a model and at no cost: a spreadsheet already has a header row. What
  you supply is what the file is and the mapping — which column is which —
  both guessed and both confirmed before anything is proposed,
  because a plausible wrong guess would write a close date into the value
  column across a whole pipeline and every review card would still look
  reasonable, and a file of people read as deals would propose a pipeline named
  after colleagues. After that it is the path a report takes: proposals, one
  review screen, one write path. A deal is matched on its CRM id and nothing
  else; a person, who has no id in any export, by email address and then by
  name — the same rule the people named on an imported report are matched by,
  shared between the two so they cannot drift. Somebody new arrives at the
  customer unless a column says otherwise. A blank cell is never a change, so an import cannot
  clear something you typed; an unreadable one stops its row by number and
  says why — including a cell no field could hold, which used to throw one row
  into the batch and take the whole import down with it; and an ambiguous
  numeric date is refused by name rather than read as a guess, because
  03/04/2026 is a different quarter depending on who pressed export. Two rows
  that share a name but carry different explicit email addresses are two
  people, and a name written with combining marks is not the same name with
  them stripped — both found by review after this shipped. An install-base
  file names its snapshot date once, typed on the confirm screen
  rather than read from a column — a file whose every row claimed its own date
  would be several snapshots wearing one upload — and if it lists fewer product
  families than the last snapshot held, the screen says so before anything is
  proposed: filed under a new date, the families it leaves out read as a fall
  to zero, and every review card for that is an ordinary create.
- **Hand an account over.** A snapshot of where things stand with an ask at the
  top — the part the other team acts on — stored, and readable on a link that
  needs no login. It does not change as the account does: that is the
  difference between it and the one-pager. The link carries an expiry you
  choose, can be ended immediately, gives a new address if you share it again,
  and dies when the handoff is archived. It can also carry a **passphrase**,
  sent separately from the link, which is what makes a forwarded link useless
  on its own; a locked page renders the box and nothing else, so the account is
  not in the markup at all until the word is right. Re-sharing never carries
  the old word onto the new address, and the screen that hands you the link
  says which of the two kinds it is.
- **What a run needs, before you press it.** A plan draft and a brief say what
  is missing rather than refusing after the click, and the day's AI spend sits
  against the cap on Home and beside the research button — the cap used to be
  invisible until it bit.
- **What day it is** is decided once, in `APP_TIMEZONE` (default US Pacific),
  by `lib/clock.ts`. Every "today" in the app goes through it: what is coming
  up, what is overdue, the date stamped on an import or an archive, when the
  fiscal quarter turns over, and when the daily AI cap resets.
- **When something fails, it says what failed.** A validation error names the
  field, a database error is explained, and anything else shows its real
  message. A proposal that cannot be applied because someone edited the record
  first says so, names the field, and links to the record as it stands.
- **Budget.** Every model call is a run with provider, model, usage, and cost.
  Runs refuse to start past a daily cap or while another run is in flight for
  the account. AWS does not publish its Bedrock rates anywhere this app can
  read, so none are assumed: until the real rates are configured, a cost is
  derived from published list prices and is labelled "estimated" wherever it
  appears.
- **Nothing is deleted.** Accounts, deals, contacts, plays, meetings,
  follow-ups, uploaded reports and research notes are archived instead. An archived record leaves every list, the
  pipeline, search, the attention list and anything the model reads, and
  whatever was still proposed for it is rejected. Its history survives and it
  can be restored from the Archived block. A proposal may restore a record the
  model still sees evidence for, but it can never archive one. Re-importing a
  report that still lists an archived deal proposes bringing it back rather
  than failing on the duplicate id.
- **Search** across every account from the nav, including what was said:
  accounts, deals by name, id, next step or notes, people by name, email or
  title, plays by title or thesis, follow-ups, meeting titles **and their
  notes and summaries**, and the findings in accepted research. A hit shows
  the line it matched, not just a title.
- **Research.** A run reads public sources about the account — what the
  organisation is doing and where its infrastructure is going — and comes back
  with a draft note. Standard is up to eight searches and five page reads;
  Deep, the default, up to fifteen and ten. Two guards run in code before anyone sees it: the page a finding cites
  must be one a search actually returned, and the sentence it quotes must
  appear in what the search produced. Anything failing both after one repair
  attempt is dropped and counted; a note with nothing left is not saved at
  all. You tick the findings worth keeping and accept, which is the only way
  research reaches a brief or a plan — and it arrives wrapped as untrusted
  source material, because it was written from web pages. This is the one call
  that leaves AWS: it sends the account's name, headquarters, region and confirmed web domain, the
  emphasis you type, the team's focus areas, and the titles of up to ten notes
  already kept (so it looks for something new), and nothing else.
- **A note reads as a dossier, and says each thing once.** An accepted note is
  a card — title, date, how many findings were kept of how many, and the
  model's own summary — and under it one card per dossier topic, carrying that
  topic's findings and its count, including the topics this pass found nothing
  on. The finding itself stays a row: it is a sentence, a confidence pill and
  a source, and fifty bordered boxes is more chrome than content. Two notes
  are open, `?all=1` opens the rest, and changing what a note says is
  `?note=<id>` rather than a disclosure — which is what took this page from
  1.4 MB to 253 KB at fifteen accounts of four fifty-finding notes each.
  Each run confirms the organisation first (shown as "Researched as"), reads
  filings and earnings calls when the company is listed, keeps the search
  index's date for each page, and offers buying-group guesses as discovery
  questions; Account watch leads with what changed, most important first.
  A run starts from a plan (what it looks for, how long, what it costs) and
  shows its searches and fetches as it makes them; the review that follows
  says once that keeping is not verifying.
  Since then research has become a reading page rather than a review page.
  It opens on a brief: why now (compelling events and recent triggers),
  where we fit (findings that touch each Team direction focus area, with a
  "so what"), and what was kept since you last looked. The reads behind it
  come from extraction, or from one "Read what we know" pass for notes kept
  before. Then what we know by topic across every kept run (newest first,
  one finding per topic, `?topic=<topic>` for the rest), each finding with a
  source kind and its age, and the runs listed under it. `?read=<id>` is for
  reading and opens no review control, `?note=<id>` is still where a note is
  adjusted, and `?all=1` lays every note out. Sources, dates and evidence
  share one compact row under each finding, and a quotation from the original
  page is labelled apart from one from the generated report. The account
  overview previews three findings chosen the way the brief chooses (a
  reason to act, where we fit, then the newest by topic), each a link to
  the exact finding, and never promotes the model's summary above a finding a
  person kept.
- **Drafting the plan.** Reads everything on file plus accepted research and
  proposes a thesis and three to six named plays, each linked to the deals and
  people it turns on and each citing a record. A title that matches an
  existing play updates it instead of duplicating it, including one that was
  archived. It cannot set a play's status and cannot archive anything. A new
  draft replaces the previous one still waiting for review.
- **Things can leave as data.** A CSV of the pipeline as filtered, and of an
  account's deals, people and open follow-ups. Raw values rather than what the
  screen shows, so a money column sums; a cell that would be a formula in Excel
  is defused; a byte order mark so accents survive.
- **An account going quiet is visible.** Accounts marks any account nobody has
  written anything down about for three weeks. It reads `change_log`, so it
  means exactly that and says so — a meeting you have not recorded still counts
  as silence.
- **One page that says whether the deployment is wired up.** `/setup`, linked
  from Home: the path `DB_PATH` actually resolved to, whether the data
  directory is writable, what day the app thinks it is and in which zone,
  whether each provider is configured and every model priced, whether
  `APP_HOSTNAME` matches the host requests arrive on — a mismatch renders every
  page and refuses every save — and how old the newest backup in S3 is, read
  from S3. A provider error it recognises is prefixed with what it actually
  means: an IMDSv2 hop limit, a model ARN for the wrong region, a bare model id
  where the region wants an inference profile — on every run, not only on the
  diagnostics, because those five failures will appear on an import or a brief
  long before anyone opens `/setup`. Every check on that page gives up after
  six seconds: pointed at an address that drops packets, which is what a
  security group with no egress rule looks like from inside the container, it
  used to hang past two minutes — a diagnostics page the thing it diagnoses
  can hang is the one screen you cannot get an answer out of on the day you
  need it.
- **The checks run themselves.** GitHub Actions runs typecheck, the 1,158
  tests across 100 files, the build, the privacy check and all twenty-five
  browser flows on every push — run 198 is green on `9bc182b`. No secrets:
  the tests make their own in-memory database and the flows seed their own
  users and force `AI_FAKE=1`.
- **Check providers**, on Home, asks each provider one short question and says
  which answered, with what model, how many tokens and what it cost. It works
  in the deployed container, which `npm run smoke:providers` cannot — that
  needs `tsx`, which is not in the image.
- **It can be deployed.** `deploy/` is a two-stage image, Compose with a named
  volume for the database and the uploads, Caddy for the certificate and the
  security headers, and a nightly snapshot to S3. The backup uses `VACUUM
  INTO` rather than copying the database file, because with WAL on, the file
  alone restores something with no tables in it — the runbook in
  `deploy/README.md` includes the restore drill that proves it.
- **Fake mode** (`AI_FAKE=1`) runs import, extraction, briefs, research and
  plan drafting without credentials, building its answer from the real records
  so the guards still do their work.

- **The team can say what it is for.** `/settings/direction` (under More)
  holds what the team sells, its goals, the signals that make an account
  worth its time, and what to steer away from — for the two of you,
  full-stack AI: agents, AI systems, AI security, observability. Briefs and
  plan drafts lead with what bears on it and never treat it as a fact about
  a customer; web research and Account watch are told the focus areas only,
  so they look for what you sell without your goals leaving AWS. Each save is
  kept with who made it, and the other one's stale edit is refused. A team
  selling something else — biotech, say — runs its own install with its own
  direction. The account model itself is still shaped for infrastructure
  sales: install base and product families mean little to a biotech team.

- **Ask.** `/ask` (in the nav; on a phone it takes Activity's place in the
  bar), an Ask button on every account, and ⌘K — type a question and it is
  asked. An agent answers from the app's own records with numbered sources
  that link to the records as they are now, and shows what it looked at
  while it works (DECISIONS #52). Conversations are kept and shared by the
  two of you; "Don't save this one" keeps one for a day, unless kept after.
  Asked to change something ("add a follow-up to…", "move the close date"),
  it proposes the change for review on the account and says so; nothing
  changes until one of you accepts it.
  Asked for a report, it writes one: saved under Reports (More) and on the
  account's Documents, printed or saved as PDF from the browser, and shared
  by a link with an expiry and an optional passphrase, the way a handoff is.
  Every answer and report has Copy as text and Open in Mail: plain text with
  headings, aligned tables and the sources by name, for you to send.
  "Ask about this" on a deal, play, meeting, person or follow-up starts a
  conversation about that record; ⌘K from any page asks about what the page
  shows (the pipeline with its filters, an account's tab).
  Each answer ends with two or three questions to ask next, one press each;
  Ask opens with questions worked out from the records (what slipped, what
  stalled, what is due, tomorrow's meeting). Hovering or tapping a source
  shows the record as it is now: a deal's stage, value, close and last change.
  The answer appears as it is written, with its sources checked when it
  finishes; Check providers' Ask line is streamed too, so a missing
  InvokeModelWithResponseStream permission shows there first.
  Report templates: four built in (weekly pipeline review, quarter forecast,
  account one-pager, before my 1:1) under Reports and on an account's Ask,
  and Save as template on any report, shared by the two of you. A
  template's report has exactly its section headings, checked in code.
  Charts in answers and reports — open pipeline by quarter, by stage, by
  account, and what moved — are chosen by the model and computed by the
  app from the records when the answer is written; the model never supplies
  a number. They print, copy as a text table, and show on shared reports.
- **Friday review** (Assistants; When I ask by default, Fridays at 07:00 on
  its own). For each of you it picks the deals on your accounts and the
  shared ones that need a look — close date passed, pushed out this week, no
  next step this quarter, quiet three weeks, changed by your partner — five
  at most, by a rule shown with the list, and Ask writes the review around
  them as a report with a chart and three lines for your manager. Today
  carries it until it is opened. It is paid from its own budget.
- **Close the day** (`/close`; under More, on Today from 15:00, and an
  assistant that is When I ask by default or weekdays at 17:30 on its own).
  It opens on what you did today, then each loose end of yours due today or
  late to give a day or drop, then tomorrow's first meeting, and Ask drafts
  two lines about your day from the records you touched, with sources. Send
  puts the note on your partner's Today; Copy and Open in Mail are there too.
  It never sends anything itself.
- **Scheduled reports** (Assistants; Off by default). Any report template
  that covers every account can be put on a schedule under Reports — days,
  a time, and whose Today it lands on. When it is due the assistant runs it
  on its own budget and leaves the report on Today; a schedule whose records
  have not changed since its last report is skipped.
- **Speak instead of type.** Where the browser can listen (Chrome, Edge,
  Safari on a phone), the Ask box has Speak and a meeting's notes have
  Dictate notes: what you say lands in the field like typing, to read and
  save as usual. The browser does the listening; nothing new reaches the box.
- **Useful or Wrong on every answer.** Wrong takes a line on what was
  wrong and keeps the conversation even if it was not saved;
  `/ask/feedback` (from the Ask page) lists the misses with the question,
  what Ask looked at and what was said, so its instructions and tools are
  fixed from real use. None of it is shown to the model.

- **Back goes where you came from.** Detail pages show "← Back to …" naming
  the page before (filters and all), or the page's natural parent when you
  arrived from outside; breadcrumbs above say where the page sits.
- **Plays ranked, and set aside without being dropped.** Up and down on the
  Plan tab; #1 leads the Overview as the top priority. "Information only"
  and "Not applicable" take a play out of Plan keeper and the overdue counts.
- **"No next step needed."** An open deal can be acknowledged until a date
  or as informational while it stands, from the deal, its row or Today; it
  asks again when the deal moves, and the Deals tab lists what is
  acknowledged.

- **Import more than HTML, and keep their documents.** The account report
  can be HTML, PDF, Word, Markdown, text or JSON; a JSON export in the
  documented shape becomes proposals without the model. A customer document
  (their plan, budget, RFP or notes) is kept under "Their documents" on
  Research, read by briefs, the plan draft and Ask, and cited like a meeting.

- **Peers and competitors in research.** Research names organisations like
  the account, or its competitors, and what each is doing, with a short
  summary on Research and a line on the Overview; each rests on a kept,
  sourced finding.

- **Their side, filled in.** Research proposes the people it names at the
  account as contacts to accept; the Overview card shows their people, up to
  three of their priorities (ours labelled as ours) and the roles nobody on
  file fills yet.
- **Plan tab controls kept light.** ↑ ↓ on each live play; "Info only" and
  "Not applicable" sit behind ⋯. Deal rows link to the deal's own "Not
  needed…" form.

- **Our work first.** Today shows "This week" for each of us; the account
  Overview leads with "Our work" (who did what in the last two weeks, open
  follow-ups by person, last and next meeting) and the ranked plan.

- **Team and person pages.** `/team` shows each person's accounts,
  pipeline, live plays, week and where a hand would help; `/team/<person>`
  shows their work in full.

- **Research as a workspace.** The brief on top, then tabs: What we know,
  Peers and competitors, Their documents, Still to find out, and Full report
  (the write-up open, every run listed). "Research again" is one button.

- **Faster to get around and to change things.** Five places in the main
  navigation, everything else in one More menu and ⌘K (which also runs
  commands that fit the page); g + a letter jumps, ? lists the keys. Deal
  numbers edit in place with Undo; the base type is 16px.

- **One Inbox.** Everything waiting on a decision, from every account, in
  one place with a count in the navigation: changes to review (with the
  quick ones acceptable in one press), research to keep, plan and promise
  questions, and calendar events. Accepted changes can be undone from the
  toast, a change can be corrected before it is accepted, decisions can be
  made from the keyboard (`a`, `x`, `l`, `e`; `j`/`k` in the Inbox), and an
  item can be put off until tomorrow or next week.
- **A morning briefing.** Today opens with what changed since you last
  looked, what is due today and what waits on you, all counted from the
  records. Assistants can run on their own (the scheduler takes a lease so
  ticks never overlap), and each person can connect Slack or Teams for a
  weekday morning digest of counts and a link (Settings → Connections).
- **A living account page.** Five tabs and one More menu. The Overview says
  where the account stands, what changed since you last looked (with its
  waiting changes acceptable in place) and what we know from research, and
  sets how often Account watch looks for news about it.
- **Ask looks things up, and email becomes changes.** Ask can look one
  public question up on the web for an account; the findings are cited as
  unreviewed and wait in the Inbox to keep. Each person can connect their
  own Microsoft 365 or Gmail mailbox; email with a customer becomes
  follow-ups and next steps to accept one at a time, never a stage, status
  or amount.
- **Sending, one at a time.** Recaps, meeting invites, chasers for what a
  customer promised and emails Ask drafts wait in the Inbox under To send,
  editable, and go from your own mailbox only when you press Send on each
  (after you turn on sending under Settings → Connections).
- **Fewer places.** An account's changes are reviewed in the Inbox,
  Promises and the Plan check-in are Inbox views, Close the day is a view of
  Today, and an account's plays, playbook, workshop and roadmap are tabs of
  its Plan tab. Old addresses redirect; pages say only what you need to act.
- **The AI writes summaries, cited.** With the Writer assistant on (off by
  default, its own monthly limit), Today leads with a few written sentences
  each morning and again after the close-the-day hour, and an account's Where
  it stands is written whenever its records move. Every sentence carries
  numbered links to the records it rests on; one citing anything else, or
  stating a number its sources do not hold, is dropped. The counted version
  is one press away, and shows instead whenever the written one is out of
  date. Meeting briefs now also read the last two meetings' notes, the
  account's recent email and what moved on its deals since the last meeting.
- **Ready to go live.** `deploy/README.md` has the release checklist for
  Phases 2–9 and what IT grants for email. `/setup` checks mail providers,
  failing mailboxes, email past 30 days, and that backups are encrypted and
  not kept past about 30 days. Settings → Connections can send yourself a
  test.

## What does not work yet

- This file does not know what is true on the box, and has stopped pretending
  to. It said for a long time that no model call had ever been made against a
  real provider, that the image had never been built and that nothing had
  reached S3 — and it went on saying so after all three stopped being true. The
  app is deployed, in daily use, and has made real calls through both providers.
  Everything more specific than that — the path `DB_PATH` resolved to, whether
  WAL is on, what the fiscal quarter is right now, what has been spent today,
  whether either provider answers, whether `allowedOrigins` matches the host
  the request arrived on, and the newest object under the backup prefix — is
  reported live by **`/setup`**, with **Check providers** on Home beside it.
  Ask the app, not this paragraph: a second copy of that state is a copy that
  goes stale, which is exactly what happened here.
- A handoff's share link still has no sign-in on it. With a passphrase set, a
  forwarded link is useless without the word; left blank, anyone it reaches can
  read that account until it expires or is ended. The form offers a passphrase
  every time and the screen says which kind of link you are holding, but
  nothing forces one.
- A deal row with no CRM id is added again on a second import of the same file.
  That is the decision, not a defect: there is nothing to match it on, and
  matching by name would let a rename in the CRM overwrite an unrelated deal.
  The review card says which case it is in, and rejecting it keeps every later
  import of that file quiet. A person has no id in any export, which is why
  people are matched by name — the risk a deal cannot take, because a deal
  carries money.
- Nothing on a page changes by itself. When the other one of you saves, you
  are told and offered a Refresh; you are never refreshed. That is a decision
  rather than a gap — a screen that replaced itself under your hands while
  you were typing notes would be worse than one a day stale — but it means
  there is no presence, no polling and no live update, and there will not be.
- There is no merge for a duplicated account. Deals, people, plays and
  meetings can each be merged and, from receipts onwards, un-merged; an
  account can be neither.
- Two rows for one human at two accounts are related, not collapsed. Each
  account keeps its own row, because a role, a title and what you have written
  about somebody genuinely are per-account — and the link is a screen
  affordance only. It never reaches a prompt or a handoff: naming this
  person's other customers in a document written for one of them is one
  customer's information leaking into another's.
- The paste reads an invite, not a calendar. Nothing authenticates against one,
  nothing polls, and a meeting has a start time and no duration — an hour is
  assumed, which is what makes "coming up" and "write the notes" agree.
- A deal's `owner` is a name, not a login: confirming spellings makes
  "Jamie" and "Jamie Lee" one owner, but neither is connected to one of you,
  and ownership this app can filter "mine" on still lives on the account and
  on a follow-up, not on a deal.
- A follow-up created on a meeting before that link was bound on the server is
  not guessed back to its meeting. The records exist, on the account and on
  `/follow-ups`; the meeting they came from simply does not count them. Making
  that connection is a hand edit on the task's page, on purpose: inferring it
  from timing or wording would be inventing provenance.
- A task with no account is a choice, not a defect. It lives in `Own work`
  until somebody connects it, and only a task with no source can be moved —
  anything that came from a meeting, a brief or a next step keeps the account
  and the evidence it came with.
- `/pipeline` is the heaviest page now, at 354 KB against the fixture — up from
  257 KB when every row gained a link saying where its next step stands. Still
  under the budget the `weight` flow holds, and still one page; but it is the
  one that grew, and the number is here so the next person does not have to
  rediscover it.
- A research run's search charge is counted at the published rate, which a
  failed search still adds to — the docs say an errored search is not billed
  and the counter counts it anyway, so the figure can be a cent high. The cap
  bites early rather than late, which is the direction to be wrong in.
- Research runs in the request process like everything else, so a container
  restart mid-run still stops it. What its finished turns found is saved
  after each turn, the run is recorded at what it cost by then, and "Extract
  what was found" turns that into a draft without searching again; only the
  turn in progress at the restart is lost.
- No dark mode. Long lists are capped, with the rest behind a link to the page
  that owns them rather than paginated — fine at this size, and not at ten
  times it.
- Nothing recovers a request that fails to reach the server beyond telling you
  so and keeping what you typed on screen. There is no offline mode. The
  review and brief-follow-up forms can read the server's record back to settle
  a lost reply; the ordinary forms cannot, and only say that they do not know.
- Moving a record to another account is not an edit and does not go
  through the one write path: `account_id` is not a field any patch may
  carry. It is one function instead (`lib/proposals/move.ts`), used by moving
  a deal, connecting a task from Own work and merging accounts — target live,
  version checked, what was proposed for the record rejected, and a history
  row on both accounts.
- The freshness token is `change_log`'s highest rowid for the account plus a
  count of its history and its proposals, so a new batch of proposed changes
  and a rejection move it as well as an edit; linking or unlinking a person
  across accounts now writes history too, with who did it. One consequence:
  the proposals your own meeting extraction files in the background move it
  too, so the meeting page can tell you "this account was updated" about your
  own run until you press Refresh — the notice never says who, by design. A restore from a
  `VACUUM INTO` backup can renumber rowids so that a tab opened before it compares against a higher
  number than the box now has. Both resolve on reload. The cursor the
  notice compares against is reported by each page's own render, not only by
  the account layout's, because the layout is rendered once and kept across
  client navigations: before that, walking from the overview to a meeting
  after the other of you had written showed "updated" over a page that
  already included it. Confirmed in the browser, then fixed.
- `npm run e2e` needs a Chromium that Playwright can drive, which is the one
  thing it cannot install for you — CI installs it; locally you run
  `npx playwright install chromium` once.
- Nothing vendor- or customer-identifying is committed (`npm run privacy`
  checks eight patterns over the working tree — tracked files and anything
  `git add .` would pick up — and `--history` over every commit). That check
  stays whatever the repository's visibility is: it is about what is written
  down, not about who can read it, and real customer data belongs in `data/`
  and on the box. It is a blocklist, so it only finds names it has been told
  about: a live account reached a committed planning document and a pull
  request title while the check reported clean, which is the argument for
  adding each real name the day it is first written down rather than after.
  It is scrubbed from the working tree; it remains in one commit and one pull
  request body, which was a deliberate choice rather than an oversight — the
  branch has moved on and a force-push would disrupt work in flight.

## Next

Nothing is queued, and the reason is worth keeping. The month after the
first deployment was driven by use rather than by a list: eighteen pull
requests, two of which were held back from the box after sitting down with the
app to do real work exposed something the acceptance tests had not — a
follow-up typed on a meeting that the meeting did not count, a proposal column
too narrow to read a long value in, an owner label that said "no owner" about
work that had one. Each was fixed as a bounded correction and re-verified
before the release went out. That is the loop that should produce the next
round, and this file cannot run it.

What this file can do is say what it knows has not been done:

1. What the UI plan (`docs/plans/2026-10-20-ui-overhaul-options.md`) left
   out on purpose or for later: signing in with your own Outlook or Google
   account, the outbound .ics feed of Strategy's dates, and Friday review and
   Close the day. Ask is built (DECISIONS #52) and has not yet answered a
   real question on the box: after a deploy, **Check providers** on Home
   includes "Ask, with its tools", which proves the provider takes its tool
   schemas before anyone asks. Promise keeper
   runs each morning and on Run now, not straight after notes are extracted. Nothing runs on its own
   until `SCHEDULER_SECRET` is set on the box.
