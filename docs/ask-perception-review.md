# How Ask and the assistants will feel to use

A walkthrough of Ask, reports, Friday review and Close the day, read the way
the two people who use this app will meet them. It is not research with real
users. The screens were reviewed on synthetic fixture data at 1280 px and
390 px, with one answer hand-written at real length, because the AI stand-in
used in tests answers in one sentence and hides most layout problems. Nothing
here has met a real Bedrock answer yet.

## The short version

Ask will feel trustworthy and fast to read, but it may feel slow to arrive.
Where it is most likely to disappoint:

1. **The wait.** A real question makes several tool calls before it writes
   anything.
2. **Small requests that become a review step.**
3. **Five different ways to get a summary of an account.**

The first is now addressed on screen. The other two are design decisions for
after a week of real use.

## Moment by moment

### Finding it

"Ask" is in the main navigation, on every account, and in ⌘K. If you type a
question into ⌘K, it is asked. On a phone it sits in the bottom bar.

*Perception:* nobody will miss it. The risk is the opposite: with Search, ⌘K
and Ask side by side, it is not obvious when to use which. Typing into ⌘K
settles that, because it asks or looks up depending on what was typed.

### Starting

The Ask page opens with three or four questions worked out from the data:
what slipped, what went quiet, what is due, and tomorrow's meeting.

*Perception:* this answers "what is this for?" better than any explanation
could. They are the questions a seller already has on a Monday.

### Waiting (the biggest risk)

A real answer is several Bedrock rounds, and a chart or a report adds more,
so expect 15 to 60 seconds. The page lists what Ask is reading as it goes,
then shows the answer as it is written.

*Perception:* the list of what it is reading holds attention for about ten
seconds. After that, an unexplained wait reads as "stuck".

*Now:* a running seconds count, and after 20 seconds a note that a question
reading several records can take up to a minute and that the page can be
left.

*Watch:* the cost and time shown on each answer for the first week. If
simple questions take over 20 seconds, lower the effort for short questions.

### Reading the answer

The answer leads with the conclusion in bold, then the supporting points,
then a table and a chart where they help. The first question is the page's
title, said once.

*Perception:* this reads like a colleague's note, not a chatbot. At real
length, two layout problems showed up, and both are fixed:

- Tables broke words on a phone. They now scroll inside their own box, with
  the first column held in place.
- Source markers stretched their lines.

Long source lists now fold after four.

### Trusting it

Every claim carries a numbered source. Hovering or tapping it shows the
record as it is now (stage, value, close date, last change), and on a phone
it appears as a sheet above the tab bar. Each answer also says when it was
written and what it cost.

*Perception:* this is the feature that makes Ask believable. One risk
remains: a source proves Ask *read* that record, not that its sentence about
the record is right. A confident summary with eight sources will be trusted
more than it has earned.

*Mitigation:* Useful and Wrong on every answer. Answers marked wrong are
kept together on `/ask/feedback`, so the misses can be fixed. Read that page
weekly.

### Asking it to do something

"Add a follow-up to send the sizing" becomes a proposal on the account's
review page, labelled "From Ask", with a link from the answer.

*Perception:* for a big change this feels safe. For a one-line follow-up you
asked for yourself, it can feel like bureaucracy, because you said "add" and
it says "review".

*Now built:* when Ask's proposals are only new follow-ups, they are added
with one tap on the answer itself, through the same accept path the review
page uses.

### Reports

A report opens on its own page. Save as PDF and Share by link come first;
Copy, Mail and Delete are under More.

*Perception:* the PDF is the deliverable people will judge, and it prints as
the report alone.

There is now an overlap. The account's *One page* (live), *Hand over*
(a snapshot to share) and the Ask *Account one-pager* (a written report) are
three ways to get "the account on a page", and a fourth and fifth exist if
you count the meeting brief and the research briefing.

*Now built:* One page offers "Write the one-pager", and the account's Ask
no longer lists it beside the other reports.

### Friday review and Close the day

Both are "When I ask" until switched on.

- **Friday review** caps itself at five deals and shows its rule.
- **Close the day** opens on what you did, not what you missed.

*Perception:* both are well judged. One tone risk: Close the day counts
only what was changed in the app. A day spent on calls and email can show
"Nothing you changed today is on file yet". It is accurate, but it can read
as a judgement.

*Now built:* on a day with nothing changed in the app, the page leads with
tomorrow and the loose ends, says that is normal on a day of calls, and
offers to add a task or a meeting from it.

### Two people

Kept conversations are shared by the two of you, and the Ask page now says
so. "Don't save this one" keeps a question private, and it is deleted after
a day.

*Perception:* anyone who assumed Ask was private will be surprised the first
time they see their partner's question in the list. The line under the
heading is there to prevent that surprise.

## Load, as the app grows

Each addition was reasonable on its own. Together:

- The More menu has eight entries.
- The Assistants page has eight cards.
- Today ranks a dozen kinds of item.

The cap of five on Today and "Ready" items first (two at most) keep the
first screen calm. The rest of the app is getting long to scan.

*Recommendation:* in a month, look at which More entries and assistants
were actually used, and fold away the rest.

## What to look at in the first week

These numbers are on `/ask/feedback` ("How Ask is doing"), for the last 30
days.

- **Time to answer and cost per question.** Both are on each answer now.
- **How many answers are marked Wrong, and why** (`/ask/feedback`).
- **Which starter questions get pressed.** The rest can be replaced.
- **Whether proposals from Ask are accepted or left waiting.** This is the
  signal for the one-tap idea above.
- **Whether reports are shared by link or only printed.**

## Polish done in this pass

Three commits on the branch:

1. Ask's cards got their padding back. Each answer ends in one quiet row of
   actions, and charts inside answers became a tint instead of a second
   border.
2. These changes:
   - Ask outweighs Speak in the question box.
   - Reports lead with PDF and Share.
   - An account's Ask offers only its own report.
   - "Ready" items come first on Today.
   - Accounts owned by someone who is not a user count as shared.
   - Tables scroll instead of breaking words.
   - Markers no longer stretch lines.
   - On a phone, the source preview is a sheet.
   - Sources fold after four.
   - The first question is the title.
   - Each answer says when and at what cost.
   - The Mail hint appears only after Mail is pressed.
3. Ask counts the seconds while it works, and says after 20 seconds that the page can be left.
