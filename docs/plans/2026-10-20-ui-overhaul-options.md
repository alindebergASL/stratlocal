# UI overhaul: options

Planning only. Nothing in the app changes on this branch yet. The mockups are
on a private design canvas (https://claude.ai/artifact/2fJtiNXB5Z7svG9nw4Yhh8);
every name and number in them is synthetic.

## The problem, measured

"Clunky, too much in my face." Measured against the load fixture
(`scripts/load-fixture.mts`) at 1440 px wide:

| Page | Height | What fills it |
|---|---|---|
| `/accounts/<id>` | 5,737 px (about 6 screens) | next-meeting hero, then tasks again, a "Next meeting" strip again, 8 meetings, all 20 follow-ups each with Edit / Task details / Archive, all 8 plays, then 5 collapsed sections |
| `/pipeline` | 9,820 px | a full card for filters; each deal row is about 110 px tall because "No next step · open deal" and "Set a next step" stack under it |
| `/activity` | 8,696 px | every field change, raw |
| `/` (Today) | 2,946 px | Start here, then open tasks, due work, meetings, proposals, then the accounts table |
| meeting page | 1,947 px | "Prepare" appears three times above the fold; empty Review and Follow-ups cards render anyway |

The patterns behind those numbers:

1. **Everything renders at once.** Every list shows every row, and every row
   shows every action.
2. **The same thing appears several times.** The next meeting shows up in the
   hero, a strip and a list; "Add task / Add meeting" sits at the top of every
   page.
3. **Explanatory microcopy everywhere.** "Uses saved research and tasks. Draft
   suggestions are not commitments." "Task assignee: you · across all
   accounts, independent of the account scope above." Each sentence is true,
   but together they are noise.
4. **Heavy chrome.** Each section is a bordered card with a shaded header bar,
   so headers carry as much visual weight as content.
5. **Navigation is flat.** Five equal top links and no sense of "where my
   accounts are"; the account switcher lives only in ⌘K.

## What the research says

These sources were read in full; the URLs are at the end.

- **Two levels of disclosure at most, split by how often things are used.**
  Whatever is on the first screen tells people it matters; going beyond two
  levels hurts usability (NN/g, progressive disclosure).
- **Cap what a record page shows.** Attio's record page shows at most 6
  highlights and 5 detail attributes. Everything else sits behind tabs.
- **Peek, don't navigate.** A non-modal side panel keeps the list in view.
  Notion, Twenty and the Material list-detail layout all work this way, and
  NN/g prefers a side panel to a modal or an accordion.
- **Triage queues.** Incoming items wait in one queue and each gets a
  one-key decision; Linear Triage and Superhuman work this way. Items must
  clear themselves once resolved, or the queue becomes a chore (NN/g).
- **Summary first, source one click away.** Granola shows "My notes" next to
  an "Enhanced" view, and each bullet traces back to the source.
- **Chrome should recede.** Linear's 2024–2026 refreshes dimmed the sidebar,
  cut icons and softened separators. Their line: "structure should be felt
  not seen."
- **Watch the novelty tax.** The Browser Company walked back parts of Arc in
  Dia because the unusual model put people off. Keep it familiar.

## Four directions

### A · Inbox

Home becomes one queue of things that need a decision, one line each: a
meeting to prepare, notes to write, proposals to review, overdue follow-ups,
and what Jamie changed. Selecting an item shows a detail pane with the reason
it is there, the minimum context, and two or three actions. Clearing it
removes it. On a phone it is a card list with a bottom tab bar.

- **Fits because:** the app already ranks attention (`lib/glance.ts`, the
  Start here reason) and already has things needing a decision (proposals,
  research findings, partner changes).
- **Risk:** it only covers "what's next". Account and pipeline still need a
  home.

### B · Workspace: sidebar, tabs, peek

The layout of Attio, Linear and Twenty. A quiet left sidebar holds Inbox,
Pipeline, Tasks, Activity and your accounts. An account becomes a compact
header (name and 4 key facts), then tabs: Overview · Plan · Deals · Meetings
· People · Research · Files. Overview holds three things: up next, the plan
in one sentence plus each play on one line, and this quarter's deals.
Pipeline becomes one-line rows grouped by quarter, with filter chips instead
of a filter card. Clicking a row opens a peek panel where the next step can
be edited without leaving the list.

- **Fits because:** it caps every page by construction. The account page
  goes from about 6 screens to 1.
- **Risk:** the most work. It touches every page's layout, though not the
  data or the write paths.

### C · Document

The account plan reads as a page. The thesis is a sentence, each play is a
heading with prose under it, and deals and people appear inline as chips.
AI proposals sit in the margin like comments, with Accept, Skip and the
quote. The meeting page becomes a notepad in the style of Granola: write
during the call, with the brief in a side panel and one "Turn notes into
changes" button at the end.

- **Fits because:** "living plan with named plays" is a document, and notes
  are typed on a phone right after the call.
- **Risk:** cross-account views (pipeline, tasks) still need tables, so this
  is a treatment for two pages, not a whole app.

### D · Focus

Home shows Now (one large card with its reason), Next (three lines) and
Later (collapsed). Everything else is a quiet link or ⌘K.

- **Fits because:** it is the existing "Start here" taken to its conclusion.
- **Risk:** it hides too much for a weekly pipeline review, so it works best
  as a home screen.

## Recommendation

Use **B as the frame, A as home, and C for the meeting and plan pages.**
Sidebar plus tabs fixes the "everything at once" problem everywhere. The
inbox replaces Today's six stacked panels. The document treatment is what
the two most-used pages (plan and meeting) want. D is a smaller fallback if
we want a one-PR improvement first.

These rules apply whichever direction we pick:

- Lists show 3–5 rows and a "View all N" link; row actions appear on hover
  or in the peek, not on every row.
- One place per fact. The next meeting appears once per page.
- Explanatory copy goes behind a "Why?" disclosure or into the empty state.
- Section headers become plain labels. No shaded bars and no card around
  every section.
- Empty sections do not render.

Everything in DECISIONS stays as it is: proposals still need an explicit
accept, the reason a thing is surfaced stays visible, it works at 390 px,
and colours remain tokens in `globals.css`.

## Round 2: how it should feel to use every day

The owner liked parts of all four directions, so this round combines them.
It asks a different question: what would make someone *enjoy* opening this
every morning? The canvas has a second page, "A day with Strategy", with seven
screens in the order a seller meets them on a normal day.

### What the research says about daily enjoyment

People love a daily tool when it does three things:

1. **It is faster than their thinking.**
2. **It closes loops visibly.**
3. **It makes them look and feel competent.**

Polish counts only after those three. The evidence, and what each finding
means for this app:

| Principle | Evidence | What it means here |
|---|---|---|
| Instant beats pretty | NN/g response limits (0.1 s feels direct, 1 s keeps flow); Doherty threshold (under 400 ms is "addicting"); Superhuman's 100 ms rule; Linear applies changes locally first | Opening a brief, switching account and ticking a task never show a spinner, including on a phone in a car park |
| Ritual-shaped, not a blank dashboard | Sunsama's morning plan and shutdown flow; Superhuman's checklist completion went from 30% to 98% once the steps were made mandatory with defaults | A fixed morning view and a two-minute "close the day" step |
| Close open loops | Zeigarnik effect; Masicampo & Baumeister 2011: a *specific plan* for an unfinished goal stops it intruding, a list does not | Every call ends with dated follow-ups; the day ends with every loose end given a day or dropped |
| Show progress | Amabile & Kramer, about 12,000 diary entries: progress on meaningful work is "by far" the top driver of a good day, and setbacks hit 2–3× harder | A "cleared today" bar; "Halcyon moved forward"; slips stated plainly, not in alarm red |
| Design the peaks and the ending | NN/g peak-end rule | The peaks are "brief ready" and "notes became clean changes". End the day and the week on what got done, not on an overdue list |
| Keep AI and human facts apart, and show the source | Granola (user's notes in black, AI text in grey, trace a line back to the transcript); Linear Triage Intelligence keeps human-set and suggested values apart | Each proposed change shows before → after and the sentence *you wrote* that it came from |
| Make dismissing and correcting cheap | Microsoft HAX guidelines G8, G9 and G11; Copilot study: acceptance rate drives perceived productivity | One card at a time, one tap to accept or skip, fewer and higher-precision proposals; "accept the rest" only for low-risk fields |
| Calm, at the edge of attention | Amber Case, calm technology | Jamie's changes arrive as a morning digest and a quiet presence badge, not as alerts |
| Serve the seller, not management | Gartner 2024: 50% of sellers feel overwhelmed by their tech and are 45% less likely to hit quota; reps resent CRMs used to watch them | Every input pays back the same day: a better brief, a kept promise, a summary to forward |
| Delight only on top of solid basics | Kano model; aesthetic-usability effect (it forgives small issues, not large ones) | A satisfying check and an "all clear" state, only once speed and accuracy are right |

Things that make a daily tool a chore: spinners on common actions, blank
forms, AI that dumps twenty low-confidence edits with no source, optional
setup side-quests, alerts for every partner edit, and a day that ends on a
wall of red.

### A day with Strategy

1. **8:10, Today (desktop).** "Good morning, Alex. Two meetings today and
   three things to clear. Nothing is on fire."
   - A cleared-today bar.
   - One "Next up" card, with the goal of the meeting and a reassurance:
     "you sent the sizing you promised".
   - A short list to tick off.
   - On the side: today's two meetings, Jamie's changes since yesterday in
     three lines, and this quarter in one number.

   Combines A, B and D.
2. **11:20, the brief on a phone.** The one goal of the call, who is in the
   room with one line each, two questions, and "You kept your promise".
   Sources are one tap away. A big "Start notes" button sits under the thumb.
3. **12:32, notes straight after the call.** A blank notepad. Write it however
   it comes out; "→" marks a promise. Then "Done · update the account".
4. **12:35, changes to approve.** One card at a time: before → after, and
   "You wrote: …" quoting the notes. Accept or Skip, with a progress strip.
   It ends with "Halcyon is up to date. 5 changes saved, under three minutes
   from the end of the call."
5. **14:00, an account.** The quiet sidebar from B, the plan as a document
   from C, and hover cards on people. A "since this morning" margin shows what
   changed and who did it. "Jamie is here too" shows when both of you are on
   the account.
6. **Friday, pipeline review.** Instead of 600 rows: "5 deals need a look. The
   other 15 have not changed and have a next step." Step through them one at
   a time, each with the reason it is on the list. It ends with "Done in 11
   minutes" and "Copy the summary for your manager".
7. **17:40, close the day.** It opens on what you did, not what you missed.
   Two loose ends, each given a day or dropped, then tomorrow's first meeting.
   "Close the day" sends Jamie a two-line summary.

### What this needs that the app does not have yet

Most of it is a new arrangement of data the app already holds:
- `glance.ts` already ranks attention.
- Proposals already carry their quote.
- `change_log` already knows who changed what.
- Follow-ups already have due dates.

The genuinely new pieces, each a decision:

- **Instant everywhere.** It needs client-side caching and optimistic updates.
  That is a technical change, not a visual one.
- **"Brief ready by 8".** It means generating briefs on a schedule, which
  spends AI budget without anyone pressing a button. Today nothing runs on
  its own (DECISIONS 1 and 4 still hold, because a brief is not a change).
- **"Jamie is here too".** Presence needs a heartbeat. The freshness notice
  already detects that the other person *saved*; it does not detect that they
  are *viewing*.
- **The Friday "needs a look" list.** Rules from data the app has: no next
  step, close date past or moved, quiet for N weeks, partner changed it.
- **"Accept the rest".** The accept-all route exists; this would limit it to
  low-risk fields.
- **Close the day.** A small new flow, and the summary to Jamie would be a
  new notification channel.

## Round 3: clutter risks, blind spots, agents

### Clutter fixes now on the canvas

- **Normal-day Today has three zones, not six.** The meeting appears once, in
  the Next-up card, with later meetings as a single line. The quarter number
  has moved to Pipeline. Jamie appears only as an item in the list, and only
  when the change touches something you own. The count no longer appears in
  three places.
- **There is a heavy-day Today**, built at the volume the test data actually
  has: three meetings and 104 overdue items. It shows "Today's five", picked
  by a rule shown under "How these were picked". The backlog is one line that
  leads to a separate sorting pass.
- **Changes to approve are grouped.** Both new people go on one card.
  "Accept the rest" is limited to dates and people. The quote is a neutral
  block instead of a third tint.
- **The account plan expands only the play that moved.** The others are one
  line each.
- **Friday review shows its cap and its rule.** "31 more have no next step.
  Set them in one pass." "14 look fine."
- **Evening is one sentence, the loose ends and tomorrow.** No scorecard.

### Blind spots

**The direction contradicts settled decisions in three places.** Each needs an
explicit yes, or a change to the design.

- Presence ("Jamie is here too") is ruled out in STATUS ("no presence, no
  polling and no live update, and there will not be"). It has been taken out
  of the mockup and replaced with "Jamie edited 20 min ago", which the
  freshness token already supports.
- A brief that is "ready by 8" means AI running on a schedule. Nothing does
  that today, and DECISIONS 6 says there is no worker and no queue. Research
  already dies on a container restart.
- The summary to Jamie at close of day needs a channel the app does not have:
  no email and no push.

**Journeys the storyboard skips**, which are some of the heaviest screens in
the app:

- First import of a CRM report. That is the largest review there is: dozens
  of proposals.
- Research: keep or drop findings, and reading a note.
- Handoff to another account team: a share link with a passphrase.
- Duplicates and merges (deals, people, plays).
- The "someone else saved first" conflict.
- Quarterly account planning (plan draft) and the fiscal quarter turning
  over.
- Install base.

**Calendar is the hidden dependency.** Every "today" screen assumes meetings
are already in the app, but today they are typed in or pasted from an invite.
If a meeting is not entered, the morning screen is confidently wrong.
Connecting a calendar would be the biggest single enabler, and a data-boundary
decision.

**Bad days are not designed.** The calm design must keep the app's honesty
about failure:

- The AI is down, or the daily cap is hit at 11:15.
- The connection drops in the car park. There is no offline mode, so the
  brief should be readable without a signal.
- "Outcome unknown" after a lost reply.
- The AI got it wrong. There should be an easy "this is wrong" that teaches
  nothing silently and keeps the record clean.

**The friendly sentences must be computed, not generated.** "Nothing is on
fire", "Biggest step" and "Today's five" are claims. Each needs a rule behind
it that you can inspect (DECISIONS 2 and 37: model prose is not promoted to
fact). A cheerful sentence that is wrong once costs more trust than ten plain
ones.

**Two people, one queue.** Accounts with no owner belong to both of you
(DECISIONS 26). Without a "mine" or "I've got it" claim, either both of you
clear the same item, or neither does because each assumes the other will.

**Phone and accessibility.**
- Hover cards do not exist on a phone; tapping must do the same.
- Swipe gestures need visible buttons as well.
- Shortcuts must never be the only way to do something.
- State must not be shown by colour alone.

**Moving people's cheese.** Two daily users have muscle memory and bookmarks
(`/follow-ups`, `#action-…` anchors). DECISIONS 25 says "an affordance that
moves must arrive". Roll out page by page, keep the old routes working, and
redirect rather than delete.

**Knowing whether it worked.** Decide the measures before building. Two
candidates:
- Minutes from a call ending to its notes being processed.
- How often the backlog grows.

These can be read from `change_log` and `ai_runs` without adding tracking.
The STATUS "use it, then fix it" loop is the real test.

**The data still has to get in.** The redesign makes reviewing cheap. Typing
notes on a phone is still the expensive part, so voice dictation into the
notepad is worth considering.

### Using more of the agentic side

Every AI feature today waits to be pressed: brief, extraction, research, plan
draft, invite and report import. The app's rule "the model proposes, a person
accepts" turns out to be exactly the shape agent products are converging on:
agents do the legwork in the background, and their output lands in a queue
for a person to decide. So the move is not "let the AI write records". It is
to let the AI *start on its own* and keep *finishing* with the person.

The assistants, each one on the canvas:

| Assistant | Trigger | What it leaves you | Builds on |
|---|---|---|---|
| Meeting prep | the evening before a meeting | a brief, including "what you promised last time" | `lib/meetings/brief.ts`, follow-ups |
| Debrief | you tap Done on notes | changes to approve, plus a recap email draft you send yourself | `lib/meetings/extract.ts` |
| Promise keeper | after every set of notes | promises found ("→ we send…"), with reminders two days before due | extraction's follow-ups, due dates |
| Account watch | weekly | public news, kept only if it touches a play; keep or drop | `lib/research` (public identity only, DECISIONS 3) |
| Friday prep | Friday 7:00 | the five deals that need a look, with suggested next steps quoted from notes | pipeline, `change_log`, notes |
| Plan keeper | monthly | quiet plays flagged, and a refreshed plan draft to edit | `lib/plan/draft.ts` |
| Handoff writer | on request, or before time off | a handoff draft to review and send | `lib/handoff` |
| Ask the account | ⌘K | an answer that quotes your own records, with numbered sources | the brief's context pack |

How they should behave, whichever ones are built:

- **Three settings per assistant: Off, When I ask, On its own.** "On its own"
  means it runs on its schedule and queues what it finds. There is no setting
  that writes a record without a person (DECISIONS 1 stays).
- **One line about what ran overnight, not a feed.** "Prepared 2 briefs,
  found 1 news item, picked 5 deals for Friday." Each run can be opened to
  show what it read, where the data went (our AWS, or web search with the
  public name only), and what it cost.
- **Budget is visible and binding.** Spend against the daily cap is shown on
  the Assistants page. Scheduled runs stop short of the cap and say so,
  leaving room for what you press yourself.
- **Every claim has a source a tap away**, as briefs and extraction do today.
  An answer from Ask quotes records and never web text unless that text was
  kept.
- **Nothing is sent outside the app.** The recap email opens in your own mail
  client; the app never sends it.
- **Quiet by default.** An assistant that finds nothing says nothing.
  "Nothing new" is a valid result, and a run is skipped when nothing has
  changed since the last one.
- **Three kinds of output, never mixed.** *Notify* means something happened
  and there is nothing to do. *Question* means the assistant is stuck and
  asks you. *Review* means there is a change to approve. This comes from
  LangChain's ambient-agent inbox, and it maps onto Today.
- **Keep queues short enough to read.** Approval fatigue turns review into
  rubber-stamping (Knight/UW autonomy levels). That is why there is no
  "graduate to autopilot" switch, and why Friday prep picks five deals.
- **A brief must change the call.** If it would not change the agenda, a
  question or a follow-up, it is just a nicer summary (Metacto). So it leads
  with what is different since last time.
- **The strategy stays yours.** People who trust AI more think less
  critically about it (Microsoft/CMU, CHI 2025). Plan keeper asks questions
  and flags quiet plays; it does not rewrite the thesis.
- **Give the task, get a draft back.** From any item you can say "draft this"
  and get a reviewable draft, the way GitHub's Copilot agent returns a draft
  PR. This works only for tasks with a clear scope.
- **Show the cost before a run starts, and offer a "try it on one account"**
  run before an assistant is switched on (Clay, Gong).

Why this restraint: agents writing straight to records is the documented
failure. Gong's extractor overwrites values, and Replit's agent deleted a
production database despite being told not to. On Salesforce's
CRMArena-Pro benchmark, leading agents finish about 35% of multi-step CRM
tasks, against over 83% for narrow workflows. The fix is architectural
(proposals only), not something a prompt can promise. Gartner expects over
40% of agentic projects to be scrapped by 2027, mostly for unclear value.
Each assistant here earns its place by saving a specific weekly chore.

What it costs to build:
- A scheduler. That means revisiting DECISIONS 6: a cron in the same
  container calling an internal route may be enough.
- Runs that survive a restart.
- An "assistant run" view on top of `ai_runs`.
- Per-assistant settings.

The prompts and guards mostly exist already.

## Round 4: decisions and build plan

### Decided by the owner (2026-10-20)

1. **The combined direction** ("A day with Strategy") is the target.
2. **Assistants may start work on a schedule**, spending AI budget without a
   button press. They still never write a record: what they find is a
   proposal, a question or a notice. Recorded in DECISIONS with the first
   PR that adds a scheduler. It amends DECISIONS 6 (no worker) and keeps
   DECISIONS 1 (the model proposes, a person accepts) unchanged.
3. **Connect a calendar: Outlook and Google, flexible, and Strategy gets its
   own.**
4. **Assistants to build:**
   - Debrief
   - Account watch
   - Promise keeper
   - Plan keeper
   - Handoff writer

   Meeting prep and Friday prep start as "When I ask". The default settings
   on the canvas match.
5. **Each assistant has its own budget under one total budget.**

### How the pieces work

**Scheduler.** It follows the pattern the `backup` service already uses: a
small loop in `deploy/compose.yml` that, every few minutes, calls an internal
route on `web` with a shared secret. The route decides what is due, with
assistant runs staying in the web process where `runDetached` and the daily
cap already live. No queue, no new datastore. On boot, a run left `running` by
a restart is marked failed with its reason, and re-queued if it was scheduled.

**Calendar: Outlook and Google, with more than one way in.** Owner's
decisions: Outlook, "make it flexible", Strategy should have a calendar of its
own, and include a Google Calendar hook. One
calendar module reads from several sources, so any mix works. Every source
feeds the same matching step:
- Events are matched to accounts by attendee email against contacts, then by
  email domain.
- Matched events become meetings after one tap ("Add 2 meetings").
- Unmatched ones ask "Which account?".
- Internal events are skipped and counted.
- Parsing is code, not a model (DECISIONS 27).

**Hooks, then polling.** Both providers can call us when something changes:
Google Calendar push notifications (`events.watch` channels), and Microsoft
Graph change notifications (subscriptions on events).
- Each hook arrives at one route behind the existing proxy. It is checked
  against the channel's secret token, and it only says "something changed".
- The app then fetches the changes itself, using Google's sync token or
  Graph's delta query. So a forged call can trigger a fetch but cannot insert
  anything.
- Channels and subscriptions expire. The scheduler renews them before they
  lapse.
- The scheduler also polls every 15 minutes, so a missed hook costs minutes,
  not a meeting. Published links have no hook and rely on that poll.
- Providers live behind one small interface (list changes since a cursor,
  start a watch, renew, stop), so adding a provider later does not touch
  matching or Today.

1. **Strategy's own calendar (recommended).** Strategy gets its own address,
   for example a shared mailbox `strategy@example.com`. A shared mailbox
   needs no licence. You forward a customer meeting to it, or add it to
   meetings you organise.
   - It reads only its own calendar through Microsoft Graph. IT restricts the
     app to that one mailbox: Exchange "RBAC for Applications", or the older
     Application Access Policy if the calendar role is not in the RBAC list.
   - It never sees your calendar, only what you choose to send it.
   - It needs IT once: one mailbox and one app registration.
   - Adding it as an attendee shows it on the invite. For meetings a customer
     organises, forward instead.
   - On Google, the same idea is one calendar you share with Strategy's
     service account. The service account reads only calendars shared with
     it, with no domain-wide access.
2. **Sign in with Outlook or Google.** Each of you grants read access to your
   own calendar, so nothing needs forwarding.
   - Outlook uses a Microsoft Graph delegated permission (`Calendars.Read`).
     It needs the same app registration, and possibly admin consent.
   - Google uses OAuth with the read-only events scope, through a Google
     Cloud project and consent screen, set up once.
   - The app sees everything and keeps only customer meetings.
   - The two of you can use different providers.
3. **Published calendar link (fallback).** Outlook's published link, or
   Google's "secret address in iCal format". No IT, if publishing is allowed.
   - Outlook's "Publish a calendar" option disappears when IT has blocked it.
   - Feeds refresh slowly.
   - Outlook's published feeds have reportedly stopped carrying attendees,
     which leaves matching on titles only.
4. **Paste an invite** keeps working for anything else.

**Strategy's dates out to Outlook.** A private, revocable `.ics` feed you
subscribe to in Outlook. It shows when a brief is ready, promises coming due,
handoffs and plan check-ins.
- It carries titles only, no customer notes.
- Outlook refreshes subscribed calendars every few hours, so it is a guide,
  not an alarm.
- The link has the same rules as handoff links (DECISIONS 28): 32 random
  bytes, revocable, re-issuing makes a new address.

Under every source:
- Nothing is written to your own calendar.
- Tokens and links are stored server-side and never shown again once saved.
- Time off on either of your calendars is what triggers Handoff writer.
- Calendar data stays on the box. It reaches a model only as account data, on
  Bedrock (DECISIONS 3).

**Budgets: each assistant has its own, under one total.** Owner's decision.
- **One monthly total** for everything (example: $250). It is a hard stop.
  The existing daily cap (`AI_DAILY_CAP_CENTS`, $15) stays as a second hard
  stop for a runaway day.
- **Your share** (example: $100) covers every button either of you presses.
  It may also use whatever is left unallocated.
- **Each assistant has its own monthly limit.** Examples:
  - Debrief $40
  - Account watch $30
  - Meeting prep $20
  - Plan keeper $15
  - Handoff writer $15
  - Promise keeper $10
  - Friday prep $10
- **Rules:**
  - An assistant stops at its own limit and never borrows from yours.
  - A run whose estimated cost would cross the limit is skipped and says so.
  - Turning an assistant off frees its share to "unallocated".
- **The Assistants page** shows the split as one bar, each assistant's spend
  against its limit, and whether it is on pace.
- **Build:**
  - `ai_runs` gains an `assistant` column. User-pressed runs leave it null and
    count against your share.
  - `startRun` checks, in order: the total for the month, the daily cap, then
    the assistant's own limit.
  - The limits live in a settings table edited on that page. The environment
    supplies only the starting defaults.

**What each assistant leaves in Today:**

| Assistant | Runs | Output type | New code | Reuses |
|---|---|---|---|---|
| Debrief | Done on notes | review (changes), plus a recap draft | recap email draft; promises extracted in both directions | `lib/meetings/extract.ts`, proposal review |
| Promise keeper | after extraction, and daily | notify (due in 2 days), question (they owe you, no date) | a "promise" view over follow-ups, with direction (we owe / they owe) | `action_items`, `followThrough.ts` |
| Account watch | weekly, per account | review (keep or drop), "nothing new" is silent | "new since last run" diff, play-relevance filter, cost estimate | `lib/research/run.ts`, keep/drop, `updates.ts` |
| Plan keeper | monthly, plus when a play goes quiet | question (one card at a time) | quiet-play rule from `change_log`; thesis-vs-notes check with quotes | `lib/plan/draft.ts`, plays |
| Handoff writer | time off in the calendar, or on request | review (a draft to edit and hand over) | AI-written "promises due / meetings / worth knowing" over the existing build; optional reassignment as proposals | `lib/handoff/build.ts`, share links |

Every assistant has three settings (Off, When I ask, On its own), a budget
line within the daily cap, a run log on `ai_runs`, and a "try it on one
account" run.

### Phases

Each phase ships on its own, keeps old routes working (DECISIONS 25), and
passes the widths flow at 390 px.

1. **New shell and Today.** *Built on this branch (2026-10-21).*
   - Sidebar, Today in its normal and heavy versions, and the backlog-sorting
     session.
   - Today's items are typed notify, question or review.
   - No AI change. This is the "less in your face" fix on its own.
2. **Debrief.** *Built on this branch (2026-10-21).*
   - The notes page and the one-card-at-a-time approval with grouping.
     Consequential changes come one each; new people are one card and new
     follow-ups another. "All at once" keeps the old list a tap away.
   - "Accept the rest" for people, follow-ups, dates and the summary only;
     money, stages, statuses and anything resting on a report excerpt are
     always decided one by one.
   - The recap email draft: every line quotes the notes (checked in code),
     recipients must have attended, gaps are bracketed rather than invented,
     and it leaves only through the person's own mail client.
   - Promises in both directions: extraction names the customer as owner
     when they committed, and the meeting's follow-ups open with what you
     owe them and what they owe you.
3. **Scheduler and Promise keeper.** *Built on this branch (2026-10-21).*
   - The compose loop, the internal route (shared secret; the proxy refuses
     it from outside) and restart recovery: a look that died is due again.
   - Assistant settings and the Assistants page: Off / When I ask / On its
     own, one budget bar, each assistant's spend against its limit, Run now,
     and a log of every look, including the ones that found nothing.
   - Nested budgets: monthly total, daily cap, each assistant's own limit,
     and the people's share, checked in that order by `startRun`.
   - Promise keeper, code only (no model): reminders two days before our
     promises fall due, notices when a customer's is due, and one question
     ("when did they say?") per undated customer promise, answered one card
     at a time on `/promises`. The follow-up form can now say "the customer"
     and name them.
   - Meeting prep on its own, added here so the budgets have something real
     to govern: briefs for today's meetings from 6:00 and tomorrow's from
     16:00, never over a brief that exists or was edited.
   - DECISIONS #38.
4. **Calendar.** *Built on this branch (2026-10-21).*
   - Three sources behind one provider interface: a published iCal link
     (RFC 5545 parsed in code, Outlook's Windows zone names, recurring
     series with exceptions and moved occurrences), Strategy's own Outlook
     mailbox through Graph, and a Google calendar shared with a service
     account. Graph and Google push through `/api/calendar/hook/<id>`,
     renewed by the scheduler, with a 15-minute read underneath.
   - Matching by attendee, then by a domain one account owns; internal
     events skipped and counted; "Which account?" for the rest.
   - `/calendar`: "Add N meetings" in one tap (linking to a meeting already
     there instead of making a second), and a moved or cancelled invite
     offered back as "Move the meeting" or "Archive the meeting".
   - Time off from a person's own calendar, on /calendar and, for the other
     person's coming week, on Today. Phase 7 hands it to Handoff writer.
   - Not yet: signing in with your own Outlook or Google account (option 2),
     and the outbound .ics feed of Strategy's dates. DECISIONS #42.
5. **Account watch.** *Built on this branch (2026-10-21).*
   - Weekly research on the accounts a person chooses (from the account's
     research page or the Assistants page), one account per scheduler tick
     from 7:00, paid from its own limit; the page shows what a month of
     looks will cost at recent prices.
   - The same research run with a fixed, code-written question, so nothing
     but the public identity leaves (DECISIONS #3). Only new: a source any
     earlier note cited is cut, as is anything over 60 days old, and the
     cuts are listed with the note. Nothing new, nothing left behind.
   - The same keep/drop review, with each finding marked against the plays
     by shared words (code, DECISIONS #4) and those ticked first.
   - Today carries waiting notes as one item. DECISIONS #43.
6. **Plan keeper and the plan as a page.** *Built on this branch (2026-10-21).*
   - `/accounts/<id>/plan`: the thesis, then each play with its thesis,
     next step (late in amber), owner, deals with stage, value and close,
     people, open follow-ups and when it last moved; then the open deals no
     play covers. Printable.
   - Plan keeper, daily and in code: a slipped next step, an active play
     with none, a play quiet for 30 days — one question per play.
   - Monthly per account, on Bedrock: the thesis read against six weeks of
     meeting notes; each question quotes both sides, checked in code, and
     never proposes wording.
   - Answered one card at a time on `/plans` and at the top of the plan
     page: set the next step, mark stalled, drop, "it's fine"; edit the
     thesis or "still holds". Today carries open questions as one item.
     DECISIONS #44.
7. **Handoff writer.** *Built on this branch (2026-10-21).*
   - `/handoff`: cover while someone is away, for the next time off on their
     own calendar or typed dates. Their dated follow-ups (handed to the other
     person in one press, as an ordinary edit), the meetings on their
     accounts with whether a brief is ready, customer promises due, play
     steps due. A drafted note for the person covering, each point citing
     the rows it rests on; drafted on its own three days before time off.
   - The account handoff page: "Draft it for me" fills the asks and the
     worth-knowing note from the records, citations shown; the person edits
     and creates it as before. DECISIONS #45.

All seven phases are built. Friday review, Close the day and Ask the account
remain designed and unbuilt, as planned.

Friday review, Close the day and Ask the account follow when wanted. They
are designed, but they are not in the picked set.

### Still open

- **IT, once.** Create the `strategy@` shared mailbox and one Entra app
  registration, restricted to that mailbox. That covers options 1 and 2.
  Until then, options 3 and 4 work without IT.
- **Google, once.** A Google Cloud project with the Calendar API, an OAuth
  consent screen for sign-in, and a service account for a shared Strategy
  calendar. Which of you, if either, works mainly in Google?
- **The real numbers** for the monthly total and each share. The figures
  above are placeholders, set on the Assistants page.

## Earlier questions for the owner

1. Which direction (or mix) do you want?
2. Is ⌘K plus a sidebar enough for switching accounts, or do you want an
   account switcher in the header?
3. Is there anything on today's pages you look at every day and would hate
   to lose behind a tab?
4. One big switch, or page by page (Home first, then account, then pipeline,
   then meeting)?

## Sources

- https://www.nngroup.com/articles/progressive-disclosure/
- https://www.nngroup.com/articles/minimize-cognitive-load/
- https://www.nngroup.com/articles/data-tables/
- https://www.nngroup.com/articles/dashboards-preattentive/
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://linear.app/now/behind-the-latest-design-refresh
- https://linear.app/docs/triage
- https://attio.com/help/reference/managing-your-data/records/configure-record-pages.md
- https://docs.twenty.com/getting-started/core-concepts/layout
- https://www.notion.com/releases/2022-07-20
- https://www.granola.ai/
- https://help.gong.io/docs/understanding-deal-boards.md
- https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts
- https://calmtech.com/papers/designing-calm-technology
- https://tidbits.com/2025/07/03/do-you-use-it-browser-tab-management/

Round 2 sources:

- https://blog.superhuman.com/superhuman-is-built-for-speed/
- https://review.firstround.com/superhuman-onboarding-playbook/
- https://linear.app/now/how-we-built-triage-intelligence
- https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/
- https://docs.granola.ai/help-center/taking-notes/ai-enhanced-notes
- https://www.nngroup.com/articles/response-times-3-important-limits/
- https://www.nngroup.com/articles/peak-end-rule/
- https://www.nngroup.com/articles/aesthetic-usability-effect/
- https://lawsofux.com/doherty-threshold/
- https://lawsofux.com/zeigarnik-effect/
- https://hbr.org/2011/05/the-power-of-small-wins
- https://jnd.org/emotional-design/
- https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/
- https://github.blog/news-insights/research/research-quantifying-github-copilots-impact-on-developer-productivity-and-happiness/
- https://blog.hubspot.com/sales/why-your-sales-reps-hate-crm-software
- https://www.salesforce.com/news/stories/sales-ai-statistics-2024/

Round 3 sources (agents):

- https://www.langchain.com/blog/introducing-ambient-agents
- https://linear.app/developers/aig
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task
- https://knightcolumbia.org/content/levels-of-autonomy-for-ai-agents-1
- https://www.anthropic.com/engineering/building-effective-agents
- https://www.shapeof.ai/
- https://pair.withgoogle.com/chapter/explainability-trust/
- https://www.nngroup.com/articles/designing-ai-agents/
- https://university.clay.com/fr/docs/account-research-agents
- https://help.gong.io/docs/ai-data-extractor
- https://www.metacto.com/blogs/ai-meeting-prep-workflow-briefs-built-from-crm-email-tickets-and-docs
- https://arxiv.org/abs/2505.18878
- https://www.eweek.com/news/replit-ai-coding-assistant-failure/
- https://www.betterup.com/blog/hidden-costs-workslop
- https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/

Round 4 sources (calendar):

- https://learn.microsoft.com/graph/auth-limit-mailbox-access
- https://learn.microsoft.com/en-us/answers/questions/5699139/how-to-get-the-url-or-ics-of-a-calendar
- https://learn.microsoft.com/en-us/answers/questions/5927937/outlook-published-calendar-ics-feed-stopped-includ
- https://developers.google.com/workspace/calendar/api/guides/push
- https://learn.microsoft.com/en-us/graph/webhooks
