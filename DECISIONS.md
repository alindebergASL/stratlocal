# Decisions

The few things that are settled. Add a line only for a decision that is
expensive to reverse.

1. **The model proposes; a person accepts; one function writes.** Model output
   becomes `proposals` rows. `applyEntityChange` is the only writer for
   account data and records one `change_log` row per changed field, for manual
   edits and accepted proposals alike.
2. **Source text is data, not instructions.** Anything uploaded or pasted is
   wrapped as untrusted in every prompt. A claimed quote or id is checked
   against the source in code before it is shown. A model may update records
   it was given and create only people and follow-ups; it never invents a
   deal or a play.
3. **Customer data stays in our AWS account.** Calls that carry account data go
   to Amazon Bedrock. Only web research uses the Anthropic API directly, and
   its input type can hold the account's public identity — name, headquarters,
   region, and the web domain an earlier run confirmed (#60) — the question you type, and the team's own focus areas (a short
   list of what it sells, #46), and nothing else: no deal, person, meeting,
   play or install-base row, and none of the team's goals or targets. A test
   reads that file and fails if it ever imports something that could reach
   one, and another fails if a goal ever reaches what research sends.
4. **Accepting is what makes something true.** Research findings are web text.
   They reach a model only after a person keeps them, always inside an
   untrusted wrapper, and a finding must cite a page a search actually
   returned and quote a sentence that was in it. Accepting a proposal built on
   one turns that text into a record, which every later prompt then trusts —
   so the review card shows the source, and the fields it can write are short.
5. **Nothing vendor- or customer-identifying is committed.** Generic names in
   schema, UI, prompts, and docs. Test fixtures are wholly synthetic, including
   identifiers, values, dates and narratives. This boundary also covers commit
   messages, branch names, PRs, logs and attachments. Hooks and CI check known
   identifiers without emitting matched data; manual review covers unknowns.
   Live evidence stays outside Git. Historical cleanup needs separate approval.
6. **SQLite, one process, one box.** No Postgres, no worker, no queue until two
   people actually contend for it. (#38 adds a clock, not a worker: a loop
   that knocks, while the work still runs in the web process.)
7. **Three documents.** README, STATUS, DECISIONS. No runbooks, no ADRs, no
   retrospectives.
8. **Nothing is deleted, only archived.** History is the point of this app, so
   a record that produced history stays resolvable. Archiving hides it
   everywhere and rejects what was proposed for it; restoring brings it back.
   It is a person's decision: a proposal may clear the flag, never set it.
9. **Documents are not fields.** Meeting notes and briefs are written through
   the one apply path, but history records their size instead of copying them,
   and nothing may propose one.
10. **One vocabulary, defined once.** Colour, type, spacing and the shape of a
    button live in `app/globals.css` and `components/ui.tsx`; what colour a
    status is lives in `lib/tone.ts`. A screen that needs a new look changes
    the token, not the call site. Every control carries a focus ring.
11. **It has to work on a phone.** Briefs are read before a meeting and notes
    are typed after one, both on a phone, so no screen may scroll sideways at
    390 pixels. The `widths` flow in `e2e/` is what decides that, not an
    opinion, and it measures every route including `/login`.
12. **There is one clock.** `lib/clock.ts` answers "what day is it" for the
    whole app, in `APP_TIMEZONE`. Nothing asks the browser and nothing takes
    the UTC day: the calendar day a person is living in decides what is
    overdue, what is coming up, what date a record is stamped with, and when
    the quarter turns over.
13. **Say what went wrong.** Two people run this themselves and the server log
    is not somewhere either can look, so an error reaches the screen with its
    real message rather than a placeholder. There is no untrusted user here to
    withhold internals from.
14. **Identity and ownership are a person's decision.** Merging two records,
    and moving a deal between accounts, sit outside `applyEntityChange` on
    purpose — they are not field edits and nothing a model proposes can reach
    them — but they go through it for every step they can, so a merge or a
    move is as visible in history as a typed edit.
15. **A save either happens or says why.** No action may return success having
    silently discarded or cleared something: a field the form did not render is
    untouched, not blanked; text that cannot be parsed fails with what was
    typed rather than becoming null; and nothing is trimmed to a limit in
    silence. `tests/actions.test.ts` is where that is enforced, because every
    bug of this kind is invisible from the screen.
16. **A record's own id is not a field.** A deal's id is its primary key and is
    cited by its history, its play links and its proposals; it cannot be
    edited, and an update carrying a different one is refused rather than
    quietly ignored. Correcting one is a merge, which is a person's decision
    (#14). A deal added without a CRM id gets a local one so that merge is
    possible later.
17. **Every change is something on a screen or a deletion.** Tests only where
    enumeration beats looking: fiscal math, HTML to text, the extraction,
    meeting and plan diffs, the citation and source guards, the archive
    filters, and the apply path.
18. **A save that would overwrite someone else's is refused, not merged.**
    Forms carry the row version they rendered with; the write path compares
    change_log since that version against the fields the save would change,
    and refuses only on a real overlap. `updated_at` was already on every
    entity table and read by nothing, so this needed no migration. Meeting
    notes are the exception that gets a merge, because they are the only field
    whose old value history does not keep.
19. **The date on a snapshot is the report's, not the clock's.** An install
    base is filed under the date the report describes, typed by the person
    importing it, because that date is what the trend is read against and a
    backfill filed under today invents a movement that never happened.
20. **Nothing is rendered without a bound.** A list that grows with use gets a
    cap and a way to the rest, and the way to the rest is a page or a
    parameter, never a `<details>` that hides the rows and ships them anyway.
    Counts and totals always come from the whole set. `e2e/weight.mjs` is what
    decides that.
21. **A check nobody runs is not a check.** Every check in this repository is a
    command, and every command runs in CI on every push — including the privacy
    grep, which lived in a person's memory until the one thing it existed to
    catch got committed anyway.
22. **A record is edited on its own page.** Deals, people and plays each have
    one; the account page reads and links. Editing in both places is two
    places to get it wrong, and a closed `ActionForm` still serialises its
    whole form into the payload — so a form per row is paid for on every load
    by everyone who never opens one.
23. **The record of every change is a source you can read, not just an audit
    trail.** `change_log` holds every field's old and new value with who and
    when, and for ten phases it was written thoroughly and read on one screen.
    A question about the past is answered by querying it — what moved, what
    slipped, who changed it, what a field went from and to — rather than by
    adding a snapshot table or a nightly job. Two rules keep those answers
    honest: net, not gross (a field touched twice in a window is one row, from
    where it stood at the start to where it stands now), and a change applied
    from an accepted import is always distinguished from one a person typed.
24. **A model may read a paste and fill a form; the person still presses the
    button.** Where the answer is small enough to check at a glance — an
    invite's title, date, time and attendees — it goes straight into the form
    rather than through `proposals`. Nothing is written until the person
    submits, so this does not weaken #1, and it does not earn a new proposal
    origin or a review screen. The code-side guards still apply: a name must be
    quotable from the paste, and arithmetic (a timezone conversion) is done in
    code, never asked of the model.
25. **An affordance that moves must arrive.** Merging two people was deleted
    from one page and never added to the other, and stayed missing for a whole
    phase behind a comment claiming otherwise, with the library green
    throughout — a library test cannot see a missing button.
    `tests/actionCallers.test.ts` fails when an exported server action has no
    caller, and every identity operation has a browser flow.
26. **Ownership is a fact about an account, and null means both of us.** One
    column, `accounts.owner_user_id`, answers "show me mine" for every deal,
    meeting, follow-up and history row underneath it, so the filter is one
    clause in SQL rather than a rule each screen reapplies. It is pushed into
    the query and never applied to the rows afterwards, because several of
    those queries carry a limit and a post-filter would under-report it. A
    deal's `owner` stays free text: the report writes it, and it is not a
    person this app knows. Which spellings are one owner is said separately
    (#40). No foreign key, for the reason 007 gave — a login should not be
    what blocks a restore — and nothing a model proposes can set it.
27. **Where the answer is already structured, no model reads it.** A CRM
    spreadsheet has a header row, so the import maps columns to fields from a
    table of synonyms and costs nothing. What a person supplies is not the
    review — it is the mapping, confirmed before anything is proposed, because
    a plausible wrong guess writes a close date into the value column across a
    whole pipeline and every review card still looks individually reasonable.
    Everything after that is the same path a report takes: proposals, one
    review screen, `applyEntityChange`. A blank cell is never a change, and an
    unreadable one stops its row by number and says why rather than being
    dropped from it.
28. **A handoff is a snapshot on a link, and the link is the decision.** What
    another team reads is what was reviewed and sent — built once, stored, and
    rendered from storage, so the account moving on does not rewrite it. It
    carries an ask, which is the part they act on and the only reason it is a
    document rather than the live one-pager. `/s/<token>` is the one page in
    this app with no login, so: the token is 32 random bytes and the whole
    address, there is no "never" expiry, it is revocable and re-sharing issues
    a new address, archiving ends it, every way of failing is the same 404, and
    the screen that hands you the URL says in words what that link can do.
    Nothing on the shared page queries the account or links back into the app.
    A link may also carry a passphrase, which answers the one thing the rest of
    that list does not — a link forwarded past the person it was sent to. Only
    its hash is stored, and that hash is also the key the "already answered"
    cookie is signed with, so the proof cannot be computed by somebody holding
    the address and it dies when the link is re-shared. A locked page builds
    none of the snapshot: the box is the whole page.
29. **Work that is not about a customer lives on an account that is not a
    customer.** Every follow-up needs an `account_id`, and so does every
    `change_log` row, so a todo with no account had nowhere to be and no way to
    record itself. The alternative was making both columns nullable — tidier in
    the schema, and worse everywhere else: `change_log` is the audit spine and
    would have been rebuilt, and every follow-up query inner-joins `accounts`,
    so one missed `LEFT JOIN` would hide a todo with no error at all. One
    flagged row (`accounts.kind = 'own_work'`, migration 012) leaves every one
    of those joins working untouched, so such a todo reaches Home, search and
    the follow-up list for free. The cost is that lists which are *about*
    customers have to exclude it, and that is the right cost: a miss puts a row
    on screen that should not be there, which somebody sees, rather than
    swallowing work somebody wrote down. It cannot be archived, and its account
    page redirects to the todos rather than rendering empty sections.
30. **Research may suggest records, and only through the front door.**
    `lib/research/updates.ts` reads findings a person has already kept and emits
    pending proposals; it writes nothing itself, so #1 still holds end to end.
    Four constraints on it are load-bearing and invisible from the screen, which
    is why they are written here. It runs under the `plan_draft` role, so it is
    on Bedrock: the *search* is the one call allowed off Bedrock (#3), and
    reasoning over saved evidence about a customer is not that call. It may
    propose a person, one of four account facts (legal entity, HQ, region,
    segment), or a follow-up — never a deal or a play (#2). Every suggestion
    carries the id of the finding it came from, and a name or a value must be
    literally present in that evidence rather than inferred around it. And where
    the evidence does not establish that a person holds a title *now*, it
    proposes an internal follow-up to go and confirm rather than asserting the
    role — the one case where the honest output is a question.
31. **The Bedrock client is Runtime Invoke, and the model id is the client.**
    Every call carrying customer data is a structured call, and the Mantle
    client cannot serve one: it rejects the output format that makes the answer
    a parsed object instead of prose we would have to trust. So the app builds
    `AnthropicBedrock` against the Runtime Invoke endpoint, and
    `tests/bedrockRuntime.test.ts` fails the build if that ever changes — it
    makes the Mantle constructor throw and asserts the request URL, the schema
    block and the absence of a `model` key in the body. The ids are
    `us.anthropic.claude-opus-4-6-v1` on Bedrock and `claude-opus-5` direct,
    both overridable by environment. Moving either is more than a string: the
    price-override variable name is derived from the *full* id, so a rate
    configured under the old name is not wrong, it is inert — no error, no
    warning, and a cost line that keeps saying "estimated" while somebody
    believes they set the real rate.
32. **A dated snapshot can be corrected.** `install_base` was the one record
    with no manual path at all — no form, no action, no archive — on the
    position that a snapshot keyed by import date is replaced rather than
    curated. That describes what a snapshot is and has no answer for one that
    was wrong when it was taken: a figure the model misread from a report
    table was permanent, and the trend is read off it. So a line can be added,
    edited and archived by hand, through the same write path and history as
    everything else, and re-importing a corrected report for a date already
    filed is an ordinary diff rather than a silent skip. What does not change:
    it is still filed under the report's date (#19), still one row per family
    per date, still archived only by a person, and `as_of` is settable only on
    a create — moving a line between snapshots is not a correction, it is a
    different claim about when the account looked like that.
33. **A merged-away row is a tombstone, not an archived one.** Merging is the
    answer to two rows for one thing, and it exists now for a person, a deal, a
    play and a meeting. Archiving the loser is not enough on its own, and the
    reason has been found twice: a pointer column says the row was merged, and
    without it the row is indistinguishable from an ordinary archived record.
    That costs two different things. The Archived block offers Restore for
    everything archived, and restoring a loser returns half a record — its
    follow-ups, links and attendees now answer to the keeper — so `restoreEntity`
    refuses it, in the apply path where no caller can go round it. And both
    importers match a play by normalised title, and a deal by id, against lists
    that include archived rows on purpose; a merged-away row is archived, so
    the match lands on the tombstone and the draft proposes clearing
    `archived_at`. One Accept all and the duplicate is back, on every import,
    forever. So each diff follows the pointer to the survivor, and proposes
    nothing at all when the chain leads somewhere it cannot see — silence beats
    resurrection. People carry the same pointer since migration 020; before
    it, a merged-away person was only archived, and re-importing their name
    restored them. What a merge keeps rather than resolves: links and attendees
    become the union of both rows, because each was written by somebody who
    knew something the other did not; two sets of meeting notes are both kept,
    since `raw_notes` is a large field and history holds its size, not its text;
    a brief is not merged, because it is a dated document (#9). What it never
    moves is a measurement — a deal's money, a play's status — because a merge
    is an identity operation, and whether the keeper happened to be blank must
    not decide what an account is worth. Undoing one is #39.
34. **An unknown outcome locks the write. It never reads as a success and
    never as a no-write.** When the reply to a decision is lost — the
    connection drops after the request left, the body is empty, the status is
    one the API does not have — the write may well have happened, and in the
    case this was found in it had. The screen used to say "Nothing was
    applied" there, which was a claim it could not support and an invitation
    to press Accept again on top of a write that had landed. So only an
    explicit status ever reports a decision; anything else is "not known from
    here", the one decision is held until a read of the server's own record
    settles it, and that read is a GET that changes nothing. The same rule
    one layer down: a rejected promise from a save is a failure result that
    keeps what was typed, never a success and never a lost component.
35. **The other one's change is noticed, never applied.** A page that is open
    while the account moves underneath it shows a quiet notice and an explicit
    Refresh. No page reloads itself, ever — a screen that replaces itself
    under somebody's hands while they type notes in a car park is worse than
    one a day stale — and the refresh is deferred, and says so, when taking it
    would close an open editor or discard a decision whose outcome is still
    unknown. What is half-written survives a refresh, and so does the version
    it was written against. The notice is scoped to the overview and the
    record pages; research, review and import deliberately have no control
    that could replace what is on screen. There is no presence and no polling,
    and this entry is why.
36. **Planning prose is never itself assigned work.** A deal's next step, a
    play's next step and a brief's proposed action are sentences somebody
    wrote or a model proposed; a follow-up is a commitment with an owner and a
    date. The one becomes the other only by explicit confirmation — editable
    text, a deliberate assignee or "unassigned", a deliberate date or "no
    date" — and the source text is never changed by the act. The record's id
    is derived from the account, the source and the exact words, so repeating
    the confirmation, or two people confirming at once, finds the one record;
    a next step that has changed since the draft was opened is refused rather
    than silently filed under the old words. A brief's suggestion goes through
    the proposal path with its AI origin and its evidence, re-checked at the
    moment of accepting (#1). A human edit to a brief keeps the complete
    original beside it, labelled, and is never presented as evidence-checked
    model output. A follow-up confirmed from a suggestion keeps `origin` and
    `verification` whatever was done to the text — origin says where the
    suggestion came from and verification what kind of evidence stands behind
    it, both still true of a sentence a person rewrote — and the review card
    is what says whose wording it is; the quoted model text beside it is the
    other half of that. Nothing a model wrote becomes a task without a person
    pressing the button that makes it one.
37. **Research is read, not summarised upward.** The research page opens one
    note at a time in a read-only mode (`?read=`) that exposes no review
    control; adjusting a note is a separate, deliberate route. The account
    overview previews findings a person kept, each a link to the exact
    sentence, and never promotes the model's own summary above them — a
    summary is model prose about web pages, and #2 says where that may and
    may not go. A quotation from the original source is labelled apart from
    one taken from the generated report, because they are not the same kind of
    evidence.
38. **Assistants may start on their own; they still never write a record.**
    A loop in `deploy/compose.yml` knocks on `/api/internal/tick` every few
    minutes with a shared secret; the proxy refuses that path from outside,
    and with no secret set the route does not exist. The route decides what
    is due from each assistant's own record of what it has done today, so
    there is no queue, and a look that died with a restart is simply due
    again. What an assistant finds is a notice, a question, or a brief for a
    meeting that had none — never a change to an account record (#1). A
    brief is written only where there is none and no human edit, with the
    same version check as pressing Prepare. Each assistant is Off, When I
    ask, or On its own, set by a person on the Assistants page. Money nests:
    one monthly total is a hard stop, the daily cap still applies, an
    assistant on its own reserves its own limit and stops there, and button
    presses get the rest — Run now on an assistant that is not on its own
    included, since nothing is held for it. An assistant that only reads structured records
    calls no model (#27).
39. **A merge is undone from its receipt, and never over a later edit.** Each
    merge stores, in its own transaction, the before and after of every column
    it changed on every row it touched — history could not serve, because it
    keeps a meeting's notes by size and some of a merge's writes are not
    history rows. Undoing restores a column only if nothing has written to it
    since — it still holds what the merge wrote and no history row on it is
    newer than the merge — and only on a row still on this account; anything
    else is left as it is and named, because a later edit is somebody's
    decision, even one that put the same value back, and an undo is not a way
    to overwrite it. The preview and the undo are one computation, and the
    undo refuses a plan that changed after the page showed it.
    A merge made before receipts has none and is not offered: reconstructing
    one from history would be a guess presented as a restore.
40. **Which spellings of a deal owner are one person is said by a person, and
    the deal keeps what the CRM wrote.** The report owns `deals.owner` and
    will write it again on the next import, so the text is never rewritten; a
    separate table says "this spelling is that name", and everything that
    shows or filters an owner reads through it. The app may suggest a pair
    only when it is unambiguous — a short form that fits exactly one longer
    one — and never applies a suggestion itself, because two people sharing a
    first name is ordinary and a wrong merge of owners silently moves deals
    between them in every count.
41. **A proposal is measured against what the model was shown.** Its
    "before" — what accepting it is checked against — is captured when a run
    reads the account, not when the model's answer is filed; otherwise an
    edit made while the model was working becomes the baseline its stale
    answer is compared with, and passes. A proposal for a record archived or
    merged since it was filed is a conflict, whatever its baseline. And "a
    person already said no to exactly this" means a person: a draft a newer
    run superseded is recorded with no decider, so regenerating does not
    refuse its own suggestions.
42. **Calendars are read, never written, and a meeting is a tap.** The app
    reads a published iCal link, Strategy's own Outlook mailbox (Graph, with
    an app registration IT restricts to that mailbox) or a Google calendar
    shared with a service account. Parsing and matching are code (#27):
    attendee address to contact, then a domain only one account's contacts
    use; nobody from outside means internal, skipped and counted; anything
    else is a question. An event becomes a meeting only when a person adds
    it, through the one apply path, and a move or cancellation of its invite
    is offered back to them rather than applied. A provider's hook only ever
    causes a read, and must carry its channel's secret. Time off is read
    only from a person's own calendar. A pasted link is fetched over https,
    never to a private address, and never shown again once saved.
43. **Account watch sends a fixed question, and code decides what touches a
    play.** It looks only at accounts a person chose to watch, once a week
    each, paid from its own budget (#38). The web search carries what any
    research run may carry (#3): the account's public name, headquarters and
    region, and a question written in code — never a play, a deal or a
    person. Which findings touch a play is judged by the words they share,
    in code, with the words shown, because web text reaches no model until
    a person keeps it (#4). A source any earlier note on the account cited,
    kept or not, is not news again; a look that finds nothing new leaves
    nothing behind; and it never runs over a draft still waiting for review.
44. **Plan keeper asks; the plan is only ever edited by a person.** Its
    daily questions are code (#27): a next step whose date has passed, an
    active play with none, and a play where nothing — the play, its
    follow-ups, its deals — has moved in 30 days. Its monthly thesis check
    is a model on Bedrock reading the account thesis against the last six
    weeks of meeting notes, and may only point: every question carries a
    clause copied from the thesis and a sentence copied from a named
    meeting's notes, both checked in code, and it is told never to propose
    wording. An answer is an ordinary version-checked edit of the play or
    the thesis; a question stops showing once what it was about has moved,
    so nothing goes stale. No setting lets it change a play or a thesis on
    its own.
45. **Handoff writer drafts; a person hands over.** For another team, its
    draft fills the handoff form (#24) and the link is still made only by
    Create (#28). For time off, what falls in the days away — the person's
    dated follow-ups, the meetings on their accounts, what customers promised
    for those days, the play steps due — is listed by code (#27) from their
    own calendar's time off; its note is a draft to copy, never sent. Every
    point a draft makes cites ids it was given, checked in code. Handing a
    follow-up to the other person is the ordinary version-checked save of its
    owner, as whoever pressed it; nothing reassigns work on its own.
46. **The team says what it is for, and the system reads it as direction,
    never as evidence.** One direction per install, written by the team on
    `/settings/direction`: what it sells, what it is after this half, what
    makes an account worth its time, what it steers away from. A team selling
    something else runs its own install. Briefs and plan drafts read all of it
    and are told to use it to choose what to lead with — never to state it as
    a fact about a customer, cite it, or invent a connection the records do
    not support; something important outside it is still said, and said to be
    outside it. Web research and Account watch read only the focus areas
    (#3). Meeting extraction does not read it at all, because extraction
    records what the notes say, not what the team hoped they would say. Every
    save is a new version with who wrote it, and a save from a page drawn
    before the other's is refused. With nothing written, every prompt is
    exactly what it was before this existed.
47. **An account opens on what matters; every list is a tab away.** The
    account page was every record on file in one scroll, with the same
    overdue follow-up said four times and the open pipeline at the foot of
    it. It is an Overview now — at most four things that need one of you,
    most urgent first and each said once (`lib/accountOverview.ts`), a strip
    of the numbers a seller opens it for, the biggest deals beside the plan,
    the follow-ups, who we know on their side, and research — and a tab per
    kind of record (Deals, Plan, People, Meetings, Research, Details), each
    its own route so a tab is a link and the Overview never pays for a list
    it does not show. A drafted plan is reviewed on `/review`, never
    rendered inline on the account. Nothing about what is stored, or about
    the one write path, changed.
48. **The app decides the design; the tests follow it.** A browser flow
    checks what someone can do and see, not where a control used to be, so
    when a better design moves a control the flow moves with it — the review
    page is one change at a time because the flows were rewritten for it, not
    left as a list because they could not be. Unit tests check rendered output
    and behaviour; reading app source with a regex is kept only for structural
    and security invariants (every action has a caller, research cannot carry
    account data, the cross-account person link never reaches a prompt).
49. **Every record has a page, and every link goes to it.** A follow-up is
    linked as `/follow-ups/<id>` from Today, search, promises, briefs,
    handoffs and review — never as an anchor on an account page that may not
    show it. The account Overview shows the five due soonest; the whole
    editable list is the account's Follow-ups tab.
50. **A phone is its own layout.** It is not the desktop narrowed: the main
    navigation is a tab bar along the bottom, the Overview's numbers are the
    four that decide what to do next, deal rows are cards with stage, close and
    value on one line, and Research opens on what we know. The same routes and
    the same data; only what comes first, and how much, differs.
51. **Accounts merge like records do: preview, one transaction, a receipt,
    and an undo that names what it leaves.** Every row moves through
    `lib/proposals/move.ts`, so the move is history on both accounts and what
    was proposed for a row is rejected. The kept account's fields are only
    filled, never overwritten. History, AI runs and older receipts stay filed
    under the merged-away account, which is archived and points at the kept
    one; it can be restored only by undoing the merge, never by hand. People
    with the same name on both are not merged with it — that is a decision
    about a person, made on the person's page.
52. **Ask reads everything, cites what it read, and changes nothing by
    itself.** Ask is an agent with read-only tools over the whole app
    (`lib/ask/tools.ts`), run on Bedrock only, never the direct API and never
    the web, because every question carries account data. Every claim cites
    a record a tool returned in that turn; the citations are checked in code
    with one repair turn, and one that still does not check is dropped and
    the answer says so. Notes and research reach it wrapped as untrusted;
    team direction is direction, not evidence; the cross-account person link
    never reaches it. What it would change becomes proposals on the
    account's review page, labelled "From Ask": it may update only records a
    tool returned that turn, create only people and follow-ups, and touch
    only fields a seller edits by hand — never an owner, an archive or a CRM
    id. A new plan draft does not sweep them away.
    A report it writes is checked the same way and stored as a snapshot: the
    sections as written and each source's name. Signed in, its sources link
    to the records as they are now; printed, it is the report alone; shared,
    it uses the handoff's link — an expiry, an optional passphrase, ended at
    once — and links nowhere into the app.
    A conversation is kept unless asked not to be; a temporary one is purged
    a day after its last message.
53. **A conversation can start from what you are looking at.** "Ask about
    this" on a deal, play, meeting, person or follow-up, and ⌘K from any
    page, start a conversation with a focus (`lib/ask/focus.ts`): a record,
    resolved against the records every time and no focus once it has gone,
    or a page, described in plain words with its filter values cut short and
    stripped to safe characters before they reach the prompt — an address is
    text anyone can type. A record's conversation is on that record's account.
    A report template is a question and its section headings; four are
    built in and the two of you can save more from a report. A template's
    report must have exactly those headings, checked in code like a citation.
54. **A chart's numbers come from the app, never from the model.** The model
    names a chart kind and a scope (`lib/ask/charts.ts`); the data is computed
    from the same readers the tools use at the moment the answer or report is
    written, and that snapshot is stored with it, so the chart agrees with
    the text beside it and a shared report shows the numbers as they were.
55. **An assistant that writes leaves it on Today, and sends nothing.** Friday
    review picks its deals in code by a rule shown with the list, capped at
    five, and has Ask write the review on the assistant's own budget. What it
    wrote is a line on Today (`lib/assistants/ready.ts`) until it is opened.
    Close the day and scheduled reports follow the same rule: a report or a
    draft for a person, never a message sent on their behalf.
56. **Dictation stays in the browser.** Speak and Dictate notes use the
    browser's own speech recognition (`components/Dictate.tsx`); the words
    land in the field like typing and are saved, or not, as typing is. No
    audio and no new endpoint reach the box, and where the browser cannot
    listen there is no button.
57. **Research is read by topic, and every finding says who said it and
    when.** The research page opens on what we know by topic, across every
    kept run, newest first, one finding per topic with a way to the rest
    (`?topic=`). A run is still kept and read as a note (`?read=`), but it is
    no longer the unit you read by. Each finding shows a source kind (Filing,
    Company, Public record, Press, Trade, Other) and its age, worked out in
    code from its address and date (`lib/research/provenance.ts`), and
    anything a year old says so. The model's own confidence is evidence
    detail behind the disclosure, not a label on the row.
58. **The brief is our read of kept findings, kept apart from them.** Each
    finding can carry a read (`meta.reads`, keyed by its index): a compelling
    event (dated, forces a decision, with its owner) or a trigger (something
    recent that makes now a good time), which of the Team direction focus
    areas it touches, and one "so what" line. New runs write it as they
    extract; notes kept earlier are read in one pass over their own words
    (`lib/research/reads.ts`), with no searching. A read never changes the
    finding, a focus area it names must be one of ours, and the brief says
    the reads are the model's. Why now, Where we fit and What changed since
    you last looked are then picked in code (`lib/research/brief.ts`); a
    trigger over eighteen months old is left out.
59. **A research run shows its plan first and its steps while it runs.** The
    form says what it looks for, about how long a run usually takes here (the
    median of recent runs) and what it costs, in that order and in one line.
    While it runs, each search and page fetch is shown as it is issued, read
    from the stream (`stepOf` in `lib/ai/runWebResearch.ts`) and saved on the
    run at most once a second, never over the partial report a restart
    needs. Fetches are counted as fetched, never as read. The review says
    once that keeping is not verifying; its actions sit beside the count and
    again at the end rather than stuck over the findings. Suggested account
    updates appear only when there is something kept to read, and the
    one disclosure about what leaves AWS sits at the foot of the page.
60. **Research confirms the organisation first, and goes where the hooks
    are.** Each run opens by confirming the exact entity (name, domain,
    ticker, parent, headquarters) with the page that shows it; the entity is
    stored with the note, shown at the top of the brief, and its domain is
    passed to later runs to keep them on the same organisation. That domain
    is public identity like the name, and the disclosure says it is sent.
    For a listed company the latest annual report and earnings call are
    named targets. Each finding keeps the search index's own date for its
    page (`page_age`), copied in code. The extractor offers buying-group
    hypotheses, shown under "What we still need to find out" as guesses with
    a discovery question each, never as people on the account. Account
    watch's note leads with what changed, ranked in code by reason to act,
    play matches and fit, with older items marked down.
61. **The rest of the app reads research the way the brief does.** The
    account Overview's research panel leads with what the brief would lead
    with (`overviewLeads` in `lib/research/brief.ts`): the top reason to act,
    up to two focus areas with what touches them, then the newest finding by
    topic, never the same finding or heading twice, each with its source
    kind and age, under the confirmed entity. It used to be the first
    finding of the first three topics in a fixed order.
    Briefs, plan drafts and Ask read the same: each research finding they
    are given carries its date and the earlier read (reason to act, fit, so
    what), labelled as the model's own judgement and not evidence; a reason
    to act or a fit ranks a finding into the 24 sent. The confirmed entity
    and the buying-group guesses go with it, the guesses as hypotheses that
    may never be cited or proposed as a person.
    The one-page summary uses the same three lines under the confirmed
    entity, says that which are reasons to act is the model's read, and
    opens its questions with the research's own "who decides" questions.
    Today's Account watch line says how many of the news items are reasons
    to act before how many touch a play.
62. **A follow-up you asked Ask to add is added on the answer.** When every
    change an answer proposed is a new follow-up and none rests on public
    research, the answer lists them with "Add" and "Review first"; adding
    goes through the same `acceptProposal` as the review page, one by one,
    and says what could not be added. Anything that edits a record, or cites
    research, still goes to the review page (DECISIONS 1 holds: a person
    accepts, here with one tap).
63. **One way to the account on a page.** One page is the live version;
    "Write the one-pager" on it starts the Ask report for someone else to
    read. The account's Ask page no longer lists that report beside the
    others, so the two near-twins are one entry with two outputs.
64. **Close the day does not judge a day of calls.** When nothing changed in
    the app, it leads with tomorrow and the loose ends, which are true on any
    day, says an empty record is normal on a day of calls, and offers to
    catch a task or a meeting from it.
65. **What deserves attention is marked the same way everywhere.** One
    vocabulary of signals (`components/Signal.tsx`), worked out in code in
    one pass for any number of accounts (`lib/queries/accountSignals.ts`):
    a reason to act from the research brief, overdue follow-ups, changes
    waiting for review, open deals with no next step, and an account gone
    quiet for three weeks. Each is an icon and a word as well as a colour,
    each links to where it is dealt with, and nothing renders when there is
    nothing to say. The account header carries them on every tab; on the
    Overview, whose "Needs you" already lists overdue work and next steps,
    it keeps to the rest.
    The Accounts list puts the accounts that need you first (by those
    signals, weighted: a compelling event, then overdue work, then a trigger,
    review and quiet), with A–Z a click away and a filter for those with a
    reason to act. Its header says how many have a reason to act, overdue
    follow-ups or have gone quiet. Who runs an account and its CRM id sit
    small after the signals, and an account nobody is named on says Shared.
    Pipeline rows lead with the deal, its value and stage; the account is the
    second column, quiet, with a Reason to act mark when it has one. A
    missing next step is a quiet link on the row, and the warning colour is
    kept for the quarter counts and for an open deal past its close date.
    The header says how many deals moved this week, linking to What moved.
    Friday review also names the reasons to act kept that week on your
    accounts (compelling events first, three at most), and runs when there
    is one even if no deal matched its rule.
66. **Kept research is asked about again, not trusted forever.** The research
    page lists kept findings two or more years old, and compelling events
    whose date has passed, as "Still true?". Still true records the answer
    on the note and asks again after six months; Drop unticks the finding
    the way a re-review would, without counting as a new review of the whole
    note, and deletes nothing (`lib/research/current.ts`). On the clock,
    Account watch passes over an account someone researched by hand in the
    last month; pressed by hand, it still looks.
67. **How Ask is doing is read from what is stored.** `/ask/feedback` opens
    on the last 30 days: answers and failures, median time and cost per
    answer, the share marked wrong, the changes Ask proposed and what became
    of them, reports written and shared, and questions asked more than once
    (`lib/ask/health.ts`). It sends nothing and asks no model; the answers
    marked wrong follow as before.
68. **A playbook is the team's data, never the app's code.** The steps an
    account goes through, the archetypes, the discovery questions (each
    tagged with its MEDDPICC element), the workshop and the workload
    placement rubric are one validated document (`lib/playbook/schema.ts`),
    versioned like Team direction: every save is a row, the newest is
    current, an older one can be restored, and a stale save is refused. The
    app ships only a neutral starter that names no company, product or
    person; a team's own playbook is imported or written in the app and
    lives only in its database, so it never reaches the repository and
    another team can bring a different one. The privacy check carries
    hashed fingerprints of the vendor, product and people names it must
    never let through.
    A team's playbook document (PDF, Word, HTML or text) is read in this
    process (`lib/playbook/text.ts`, unpdf and mammoth pinned), mapped into
    the playbook shape on Bedrock, and shown as a draft to check; it becomes
    the playbook only when a person saves it, and the version it replaces
    stays restorable.
    It is edited in the app: every section a list to add to, reorder,
    change and remove from, saved as a new version with a line saying what
    changed. It downloads as a file and a file loads back into the editor,
    to read before saving, which is how a playbook moves between teams.

69. **An account's archetype is a hypothesis, proposed and dated.** The
    model reads the account's records and research and proposes one of the
    playbook's archetypes with a two-sentence hypothesis; it is a proposal
    like any other and sets nothing until a person accepts it, or a person
    picks one by hand. Each change is in the account's history, so a move
    from one archetype to another quarter to quarter is visible rather than
    overwritten. A plan re-draft leaves a waiting suggestion alone.

70. **An account is on a playbook step because a person put it there.**
    Before that, nothing about the playbook nags on the account. Each move is
    kept, so the team can see how long accounts sit at each step; checklist
    ticks are kept by the item's wording, so a reworded item starts unticked.
    The next unticked item (or "move on") is the last row of the Overview's
    "Needs you": what is late or waiting comes first. A step's timebox
    becomes a follow-up only when someone presses for it, once per move.

71. **Meeting questions are the team's, chosen in code.** The playbook's
    discovery questions are picked for a meeting by the account's
    archetype, the titles of the people attending and what is still unknown,
    at most three per movement, each with the qualification element it
    uncovers and why it was chosen. The brief and plan writers are given the
    account's archetype, hypothesis, step and those questions as steering
    in the same terms as the team direction: never evidence, never cited.

72. **The qualification scorecard is eight account fields.** Each element
    (metrics, economic buyer, decision criteria and process, paper process,
    pain, champion, competition) is its own field holding a status and one
    line of evidence, so each is its own proposal, conflict check and history
    line through the one write path, with no new kind of record for merges
    and hand-offs to learn. Meeting extraction is asked for it only when the
    team has a playbook; every claim carries a quote checked against the
    notes, and a confirmed element is never moved back to partial by notes.
    Once anything is on the scorecard, what is not yet confirmed steers which
    questions a meeting gets. "Copy for Salesforce" is plain text, one line
    per element, to paste; nothing is sent anywhere.

73. **Workshop placement is the playbook's rubric, computed.** Each use
    case is rated for how much each criterion applies (not at all to
    decides it); the suggestion is the option with the highest weighted
    total and names the criteria that decided it, and a tie or nothing rated
    suggests nothing. The workshop plan is one document per account, saved
    whole with a check that nobody else saved in between. A use case goes on
    the roadmap as a play in its phase (plays gain a phase, 1 to 3); the
    Mutual Action Plan is the follow-ups on those plays, read against the
    customer's fiscal year start and budget notes, which are account fields.

74. **The playbook's artifacts are Ask templates, and Ask can read the
    playbook.** While the team has a playbook, account templates exist for
    what its steps produce: intelligence brief, question guide, outcome
    readout, workshop pack, roadmap and action plan, quarterly refresh. Their
    headings come from the playbook where it has them (the first step's
    checklist, the movements, the workshop segments). They are reports like
    any other: printed, copied, mailed or shared. Ask's playbook tool returns
    the account through the playbook (archetype, step and what is left,
    scorecard and gaps, questions, workshop, roadmap and budget timing), so
    "what does the playbook say to do next" is answered from the records.

75. **Decks are built here, from reports.** Any Ask report downloads as a
    16:9 PowerPoint (pptxgenjs, pinned): a title slide, one slide per
    section with at most six points and the full section as speaker notes,
    charts as native charts, and the sources last. Citation markers stay in
    the notes and on the sources slide, not on the slides. It is built in
    this process and sent nowhere; only the signed-in team can download
    one, never a shared link. Colours come from the team's settings, so no
    one's branding is in the code. pptxgenjs lists an image library it never
    loads; it is overridden to a fixed release so the audit stays clean.

76. **Reminders are calendar files; the quarterly refresh proposes.** A
    dated follow-up, and an account's whole action plan, download as an
    iCalendar file: all-day items with a reminder the morning before, to open
    in Outlook or any calendar. Nothing is sent and no calendar is written
    to. The Quarterly refresh assistant (off until switched on) takes each
    account on the playbook once a quarter, one a day: it proposes a
    follow-up listing qualification unchanged for a quarter, what was never
    found out and how old the research is, and asks again whether the
    archetype holds. Both wait for a person; a plan re-draft leaves them be.

77. **The first step shows what is on file.** The playbook's first step
    (pre-meeting intelligence) shows the installed base from the latest
    imported report (total, largest lines, what moved since the report
    before, what dropped out), how much research is kept and how recent, and
    the customer's fiscal year, each linked to where it is kept. Ask's
    playbook tool carries the same installed-base summary, so the
    intelligence brief is written from the import and the research together.
    A live CRM read of the installed base comes with the Salesforce connector.

78. **Salesforce is optional, read as proposals, written only on a press.**
    The connection is off until turned on in settings, and usable only when
    the box has credentials in its environment (a client-credentials
    connected app for the REST API, or a Salesforce MCP server and token);
    no secret is stored in the database. An account is matched by its CRM
    ID. Reading brings its opportunities, contacts and (if mapped) installed
    base in as proposals in the ordinary review, compared with what is on
    file so a matching record is not proposed again. The only write is the
    qualification scorecard to one opportunity, to fields named in settings,
    after the exact text is shown; there is no automatic write. Every check,
    read and write is logged with who and when. Salesforce data travels only
    between the box and the team's Salesforce, and to Bedrock as part of the
    account's records; it is never sent to the web research API. Tests use
    a fake client and a local fake MCP server.

79. **A team of any size, set up in the app.** The environment creates the
    first one or two people, as admins; admins add everyone else, set each
    person's role (the playbook's roles, or manager) and turn off someone who
    has left, who is signed out at once, cannot sign in, and keeps their
    name on what they did. The team always keeps one admin who can sign in.
    Everyone changes their own password. Branding is the app's name, the
    team's name, a small logo and the colour decks use; the app's own
    interface colours are not changed, so contrast and dark mode stay as
    designed. Playbook steps and workshop segments name who holds the role
    that leads them. Wording that assumed two people ("the two of you")
    says "the team" when there are more; the views built around one partner
    (Mine / theirs, a note for the other person) already read "theirs" as
    everyone else.

80. **A team pack carries setup, never data.** One file holds the
    playbook, team direction, saved report templates, assistant settings,
    the app's name and deck colour, and the Salesforce mapping, so another
    team can start from it. It never holds an account, a person, a logo or a
    credential, and the Salesforce connection arrives switched off. Loading
    one shows what it would change, then an admin applies it through each
    part's own save, so the playbook and direction keep their history and a
    template already present by name is left alone. The neutral starter is
    committed as `starter/team-pack.json`, checked against the code, and
    `docs/new-team-setup.md` walks a new team from deploy to first use.

81. **Security fixes are taken when they land, and unused surfaces are
    off.** Next.js went to 16.4.2 within two weeks of release, against the
    usual rule for new versions, because 16.3 carried remote-code-execution
    advisories; sharp, source-map-js, vitest and vite went to fixed releases
    older than two weeks. The app uses no next/image and no next/og, so Image
    Optimization is switched off in next.config.ts rather than left serving.
    The lockfile was resolved with npm 11 (npm 10 fails on vite's optional
    peer cycle) and installs with `npm ci` on npm 10 as before.

82. **Nothing assumes one partner.** Cover while away asks who covers when
    there is more than one other person, and the choice carries into the
    drafted note; with two of you it is the other, as before. The Close the
    day note goes on everyone else's Today. Ask's follow-ups for "others"
    are everyone but you, each named ("partner" still works). Fixed
    sentences that said "your partner" say "a teammate" or "the team".

83. **A team can keep more than one playbook.** Each is versioned on its
    own under a slug; the one there was became "default". A save goes to the
    playbook of the version it was made against, so the editor, import and
    restore change the playbook on screen. One playbook is the team's
    default; an account can use another, and choosing the default stores
    nothing, so changing the default carries every account that never chose.
    Everything that reads the playbook for an account (its tab, header,
    meetings, scorecard extraction, suggestions, Ask's tool and templates,
    the quarterly refresh) reads that account's. Team packs carry the others
    by name and add only those not already here.

84. **Research looks for what the playbook still needs, without telling the
    web.** When an account has a playbook, the web research request gains one
    fixed sentence written in code (when the organisation's money is set:
    fiscal year, budget dates, funding and grant windows); nothing of the
    playbook's own wording leaves. The model that writes the note from that
    research (Bedrock) is told the account's archetype and its open
    questions, what qualification still lacks, and whether budget timing is
    on file, as steering, never as evidence. Budget timing it finds is tied
    to a finding and offered as a change to the account's fiscal year and
    budget calendar; like any proposal resting on research it can be accepted
    only once that finding is kept, and a report excerpt needs the reviewer's
    acknowledgement.

85. **Win and loss by archetype, as the account was when the deal closed.**
    The playbook page shows deals won and lost over the last year, grouped by
    the archetype each account had on the deal's close date (read from its
    history, so a later reclassification does not rewrite the past), with
    value, the typical cycle from first on file to close, and the playbook
    step those accounts usually reached. A rate appears only once a group
    has five closed deals; below that the counts are shown. Ask's playbook
    tool carries the same summary.

86. **Back goes where you came from.** Each tab keeps a short trail of the
    pages visited (in that tab's session storage only), and detail pages show
    "← Back to …" naming the page before, returning by the browser's own back
    so its filters and scroll come with it. Arriving from outside the app it
    goes to the page's natural parent instead. Breadcrumbs above it name
    where a page sits: Accounts › account › section › page, each a link.

87. **Plays are ranked by the team, and can be set aside without being
    dropped.** On an account's Plan tab the live plays (proposed, active,
    stalled) carry a rank the team sets with up and down; #1 is the top
    priority and leads the Overview and the plan document. A play can be
    marked "information only" (kept in view, greyed) or "not applicable"
    (folded away with the done ones); either way it leaves Plan keeper, the
    Overview's overdue-play row and the plan's uncovered-deals sum, and can be
    made live again. Each rank change is an ordinary field change with
    history. The plays table was rebuilt from its own definition to accept the
    two statuses.

88. **"No next step needed", until a day or while the deal stands.** An open
    deal with no next step can be acknowledged with a reason, either until a
    date (thirty days by default; it asks again after) or as informational,
    which lasts while the deal stands. Either kind ends by itself when the
    stage, close date or status changes or a next step is written, so a
    stalled deal cannot be quietly waved through for good (the pipeline
    hygiene advice we read says the same). Acknowledged deals are not hidden:
    the Deals tab counts them under their own filter and the deal page shows
    the waiver with Undo. One rule (`lib/deals/nextStep.ts`, in JavaScript and
    SQL) decides "needs a next step" for every place that flags it: Today,
    the attention list, Needs a look, account signals, the Overview and the
    pipeline counts. The waiver is three ordinary deal fields, with history.

89. **Imports take any document, and a customer's own documents are kept as
    context.** The account report import reads HTML, PDF, Word, Markdown,
    plain text or JSON through the one reader the playbook import already
    used (`lib/documents/text.ts`), and stores the file as what it is. A JSON
    export that states its records, either in the extraction's own shape or
    the simple `{account, team, deals, install_base, plays}` one, is mapped
    straight to proposals with no model; anything else is read by the model
    as text, and the deal-id check holds either way. The same page can keep a
    document the customer gave us (their plan, a budget, an RFP, notes):
    nothing is extracted from it. It is listed under "Their documents" on
    Research, and briefs, the plan draft and Ask read the newest four,
    clipped and wrapped as untrusted, and cite them by id like a meeting. It
    is never part of web research (DECISIONS #3). It is stored as kind
    `other` with `meta_json.type = 'customer_doc'`, as Ask reports and
    spreadsheets are, rather than by rebuilding the documents table for a
    new kind.

90. **Research covers peers and competitors, labelled.** Web research has an
    eighth category: three to five organisations like the account (peers of
    similar size and mission for a public body, direct competitors for a
    business) and what each is doing in public on the same ground, dated and
    sourced. The note keeps them as `peers` (name, peer or competitor, what
    it is doing) plus a short summary. Each peer is tied to a finding of
    topic `peers` and stands only while that finding survives the checks and
    is kept, as budget timing does. They are shown in "Peers and competitors"
    on Research and as one line on the Overview, and they reach briefs and
    Ask through the research block and the intelligence brief template. The
    names come from the public research, never from our records, so the web
    request still carries only the account's public identity (DECISIONS #3).

91. **Their side: their people, their priorities, and the roles to find.**
    Research now names people who work at the account, each tied to the
    finding that names them; a name the finding does not contain is dropped.
    Each becomes a proposed customer contact (origin `research_people`) that
    quotes the finding, can be accepted only once the finding is kept, and is
    not offered again while it is pending or once the person is on file. The
    Overview's "Their side" card has three parts: People (with "N named in
    research — review"), Their priorities (up to three: kept strategy and
    leadership findings, the scorecard's Metrics and Identify pain, and our
    archetype hypothesis labelled as ours, each linking to its source), and
    Roles to find (the research's buying-group guesses that nobody on file
    fills yet). The report import's play stakeholders are still not turned
    into people: they mix both sides and carry no title to tell them apart.

92. **Our work comes first.** Today opens, under the greeting, on "This
    week": for each person, me first, the meetings held, follow-ups closed,
    deals and plays moved and research kept in the last seven days, each
    name leading to that person's page. The account Overview leads, after
    Needs you, with "Our work": who on the team touched the account in the
    last fourteen days and what they did, their open follow-ups there, and
    our last and next meeting; the ranked plan comes before the deals, and
    their side and the research follow. Counted from change_log and the
    meetings table with no model (`lib/queries/ourWork.ts`), so it is what
    happened, not what anyone remembers.

93. **A page for each person, and one for the team.** `/team/[userId]`
    shows one person's week and last 30 days, deals won this month, the
    follow-ups they owe, meetings coming up on their accounts or that they
    booked, the live plays on their accounts in each account's ranked order,
    and the accounts they own. `/team` (in the main navigation; the old
    "Team" settings page is now "Team setup") has a card per person: accounts,
    open pipeline, live plays, this week's work, and where a hand would help,
    which is overdue follow-ups plus deals closing this quarter that need a
    next step by the shared rule (DECISIONS #88). Me first, then whoever needs
    a hand most. Names on Today, the account's "Our work" and Team setup link
    to these pages. "Moved" in every count means a value changed: creating a
    deal or a play is not moving it.

94. **Research is a workspace, not a long report.** The brief stays on top;
    below it, one tab at a time, each at its own address: What we know
    (`?view=` absent), Peers and competitors (`peers`), Their documents
    (`documents`), Still to find out (`open`, with suggested account updates)
    and Full report (`report`, the newest run's write-up open, with every run
    listed and `&run=` for any one of them). Each tab shows its count. A peer
    appears once, on its own tab, not again under What we know. Running
    research again is one closed "Research again" action under the brief, open
    while a run is going; a new account still opens on the form. Older
    addresses (`?read=`, `?note=`, `?topic=`, `?finding=`, `?all=1`) open what
    they always did, under the tab they belong to.

95. **Five daily places, one list of everywhere, and keys.** The main
    navigation is Today, Accounts, Pipeline, Tasks and Ask, the same on a
    phone and a desktop. Everything else (What changed, Calendar, Close the
    day, Plan check-in, Promises, Cover while away, Reports, Search, Team,
    Assistants and the settings) is in one grouped More menu and in ⌘K, all
    read from `lib/nav/destinations.ts`, so the menu, the bar and the palette
    can no longer disagree. ⌘K also offers commands that fit the page
    (research this account again, import, open the plan document, add a
    task); each lands on the screen that does it with the form open, and the
    server action there stays the check. g + a letter jumps and ? lists the
    keys; nothing fires while typing. A toast says what happened with Undo where it can be undone, and the base
    type size is 16px. Route-level loading screens were tried and dropped: a
    `loading.tsx` turns a page's `redirect()` and `notFound()` into client-side
    ones and lets a link land on a skeleton, so skeletons are kept for
    sections streamed inside a page.

96. **One field, edited where it is.** A deal's value, stage, close date,
    status, owner and next step are edited in place on the deal page: click,
    type, Enter (Esc cancels). The new value shows at once, one field is
    saved through the one writer with the row's version, and a toast says
    Saved with Undo, which writes the old value back against the new version.
    A value that cannot be read is refused with what was typed kept (#15); a
    partner's newer edit comes back as a conflict to explain, never
    overwritten (#18). Only the fields listed in `lib/inlineFields.ts` can be
    edited this way, and forms stay for creating records.

97. **One Inbox for every decision.** `/inbox` is in the main navigation,
    with a count, and gathers what used to wait in separate places: proposed
    changes on every account (with how many are quick to check), research
    drafts to keep or drop, Plan keeper's and Promise keeper's questions, and
    calendar events to add or match to an account. It is read from each
    source as it stands (`lib/inbox/query.ts`), never copied into a table of
    its own, so it cannot drift from where a decision is recorded, and every
    decision still goes through that source's own function. "Accept N quick"
    accepts, one by one through acceptProposal, only what a glance can verify
    (a new person, a new task, a date: `isLowRisk` in lib/changeDeck.ts);
    money, stage, status and anything resting on unconfirmed evidence always
    wait for their own review. Today's question items open the Inbox; the
    Plan check-in and Promises pages stay at their addresses, and Tasks moved
    into the More menu.

98. **Undo, correct, decide by key, put off.** An accepted change can be
    undone from the toast that follows it, in the Inbox or in the review
    deck. Undo writes back only the fields whose latest change is still that
    accept, so nothing someone wrote since is overwritten; it reports what it
    kept. A record the accept created is archived (#8). The proposal goes back
    to pending as it was proposed: undo means "let me decide that again",
    not "no". A change can be corrected before accepting (Edit, or `e`), but
    only values it already proposes: an edit can never widen a change to a
    field nobody proposed, and what was proposed is kept beside what was
    applied (`proposed_json`). The deck takes `a` accept, `x` not this,
    `l` later, `e` edit; the Inbox takes `j`/`k`, Enter, `a` for the quick
    ones and `s` for later. Later puts an item off until tomorrow or next
    Monday, for that person only: it leaves the list and the count and comes
    back on the day; nothing is decided by putting it off (migration
    042_inbox).

99. **The app comes to you: a briefing, assistants on their own, a digest.**
    Today opens with a briefing: what changed since you last looked
    (Account watch findings, deals someone else moved, a teammate's changes,
    calendar events to match), what is due today (meetings and whether their
    briefs are ready, tasks due or late) and what waits on you (the Inbox,
    with how many are quick). Every number is counted from the records; no
    model writes it. "Since you last looked" is your last visit to Today, at
    most a day back, and holds through reloads within a few hours so acting
    on it does not empty it; the visit is recorded after the page renders,
    never by the render. From 15:00 the same block leads to Close the day.
    The scheduler that already existed (#38) now takes a lease, a settings
    row that only a tick finding it expired may take, so two ticks never run
    at once on a shared database. /setup and /assistants say plainly whether
    it is running; "Turn on the recommended four" sets Promise keeper,
    Meeting prep, Plan keeper and Account watch to On its own within their
    existing limits. Each person may connect their own Slack or Teams
    incoming webhook: only those services' hosts, over https; the address is
    sealed with AES-256-GCM under INTEGRATIONS_KEY and never shown again,
    only its host. The Morning digest assistant (no model, no cost) sends a
    short form of the briefing on weekday mornings, once a day per person,
    marked before sending so a failing webhook is recorded and never retried
    in a loop. It carries counts and one link; account names only for a
    person who turned them on. This amends #55: the app now sends, but only
    to a person's own channel, only what they switched on, and never a
    customer's details by default.

100. **One living page per account.** An account has five tabs (Overview,
     Deals, People, Meetings, Plan) and one More menu at every width: Go to
     (Follow-ups, Research, Playbook, Details) and Do (Import report, One
     page, Hand over, What changed here). A page reached through More names
     itself on the More button, so where you are is always on screen. Every
     address is unchanged. The Overview opens with Where it stands: two or
     three sentences counted from the records (pipeline and the biggest
     deal's stage, close date and next step; the last and next meeting; the
     live plays; the top reason to act from kept research), each clause a
     link to its record and no model involved. It replaces the strip of
     numbers. Then Since you last looked: what changed on the account's
     records, the research kept, and what of the account waits in the Inbox,
     with its quick changes acceptable right there. "Last looked" is per
     person and account (account_seen), kept apart from the research page's
     own, read without writing, and recorded by a request after the page
     renders; a visit only moves it on after half an hour. Research is What
     we know on the Overview, with each lead's source and age, and the full
     reading under More → Research. Account watch looks at each watched
     account at its own pace (daily, every 3 days, weekly or every 2 weeks;
     weekly by default), chosen on the Overview, and the Assistants page
     estimates the month from those paces (migration 044_account_seen).

101. **Ask may look one thing up on the web, through research.** Ask itself
     still runs on Bedrock and never searches (#52). It has one web tool,
     web_research, which starts an ordinary research run (the direct-API
     call of #3) for one account: the run receives the account's public
     identity and the person's own question for this turn, and nothing the
     model wrote. Before it leaves, the question passes an outbound guard
     (lib/ai/outboundGuard.ts) that refuses an email address, an amount, one
     of our deal names or the name or address of someone we know there, and
     anything over 300 characters. One lookup per question, and none while a
     research note is already waiting for review on the account. What it
     finds is the account's draft research note, waiting in the Inbox to be
     kept or dropped, and comes back to Ask wrapped as untrusted, citable
     only as an unreviewed web finding. Nothing more may be proposed in that
     turn: a web finding becomes a change only after a person keeps it (#3,
     #4).

102. **The app reads customer email, each person's own, opted in.** Each of
     you may connect your own mailbox (Microsoft 365 through Graph Mail.Read,
     limited by IT to the opted-in mailboxes; Gmail through domain-wide
     delegation with gmail.readonly) under Settings → Connections; nobody
     else's is read. A message is kept only when its people match exactly one
     account by the calendar's own rules (a contact's address, or a domain
     only that account's contacts use); internal mail, newsletters and
     anything matching nobody or two accounts are never stored, only counted.
     Kept bodies are clipped and deleted after 30 days; who, when and the
     subject stay. The Mail reader assistant (Off by default, its own monthly
     limit) reads each thread's new mail once, on Bedrock, wrapped as
     untrusted, every item quoted verbatim and checked in code, the same way
     meeting notes become changes (#2). An email may propose only follow-ups
     and promises, a deal's next step, and a person; never a stage, a status,
     an amount or a play, however it is worded, and whatever the model
     returns. Its changes are filed as plan drafts from `mail:<thread>`, say
     "From the email" with the quote, are never accepted in bulk, and are not
     cleared when a plan is drafted. Ask can read an account's kept email,
     wrapped as untrusted. This extends #42 (calendars are read, never
     written) to mail: nothing is ever sent or changed in a mailbox.

103. **Sends only what a person approved, one at a time.** The app can now
     send an email or a calendar invite: a meeting's recap, an invite to a
     meeting, a chaser for something a customer promised, and an email Ask
     drafted when asked. Every one is a draft first, shown exactly as it will
     go (recipients, subject, every word, and for an invite the time), each
     editable, and it goes only when the person who owns it presses Send on
     it. Nothing sends in bulk, and nothing scheduled or automatic sends:
     only one server action calls the send (tests/outbound.test.ts checks the
     imports). It goes from that person's own connected mailbox and calendar,
     and only when they turned on "Send from my mailbox"; at most 20 a day.
     Recipients must be live contacts on the account with that address, or
     an address the person typed, checked when saved and again at the moment
     of sending; at most 10. Ask may draft but never send, and only to
     contacts it read that turn. A draft is marked sending before the call,
     so a second press finds nothing to send; a refusal leaves it failed and
     editable; no answer leaves it unknown, never retried, until the person
     has checked their Sent folder and reopens it. What went is in the
     account's history. Chasers and invites are written by code, not a model,
     and an invite never carries the brief. This supersedes #42's "calendars
     are never written", #55's "sends nothing" and #102's "nothing is ever
     sent"; mail and calendars are still read only as #42 and #102 say.

104. **A page says what you need to act, and no more.** A paragraph stays
     only when a person needs it to act or it states a guarantee they would
     otherwise not know (nothing applied until you accept, nothing sent until
     you press Send, what leaves for web research). Everything else that
     explained a page to itself is gone or shortened to a few words.

105. **Fewer places, each complete.** An account's proposed changes are
     reviewed in the Inbox (`/inbox?kind=changes&account=`), deck or list;
     Promises and the Plan check-in are Inbox kinds, with Promises' "Coming
     up" list there too; Close the day is a view of Today (`/?view=close`).
     The old addresses redirect (next.config.ts) and nothing links to them.
     An account's plan is one Plan tab with its own tabs (Plays, Playbook,
     Workshop, Roadmap) and one link to read it as a document; the playbook
     pages keep their addresses but sit under Plan instead of More.

106. **The AI may write summaries, only cited and checked in code.** The
     Writer (an assistant, off by default, with its own monthly limit)
     writes Today's summary once in the morning and once after the
     close-the-day hour, and an account's Where it stands whenever the facts
     behind it change. It writes from an index of facts built in code from
     the records, and every sentence must cite keys from that index: a
     citation it was not given fails the run (and is retried), and a
     sentence stating a number none of its cited facts carries is dropped.
     What survives is kept with a fingerprint of the facts; an account's
     paragraph shows only while the fingerprint matches, otherwise the
     counted sentences show and the Writer is asked, in the background, to
     catch up. Pages never write while rendering. Written text sits beside
     the counts (one press away) and never changes a record. Meeting briefs
     now also read the last two meetings' notes (clipped) and the account's
     last five emails (clipped), both wrapped as untrusted and outside the
     pack the prompt treats as our own data, and the deal moves since the
     last meeting; an email is citable and its chip links to it. All of it
     runs on Bedrock.

107. **Going live keeps the promises the pages make.** Email bodies are
     cleared after 30 days on every scheduler tick, not only while the Mail
     reader is on. Offsite backups are encrypted at rest on request (S3's
     keys or a named KMS key), read back to confirm it, and refused
     otherwise; a 30-day lifecycle rule on the prefix keeps a snapshot from
     holding email longer than the app does, and `/setup` warns past 35
     days. `/setup` also says which mail providers are set up, which
     mailboxes fail and whether any old body lingers, from the app's own
     tables. Proving sending works is an ordinary draft to yourself, sent
     from the Inbox like any other (#103 holds: one send path, one press).

