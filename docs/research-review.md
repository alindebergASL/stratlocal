# Research: a deep review, and what it should become

This covers the account Research tab, how it runs, what it produces and where
that goes (Overview, briefs, the one-page summary, Account watch, Ask).

It draws on three things:
- **The screens**, at 1280 px and 390 px on fixture data, empty and full,
  with a run going from start to accepted.
- **A read of every research file.**
- **A survey of what current account-research tools do (2025–26).** Vendor
  claims are marked as such where they could not be checked. Sources are
  listed at the end.

This is not research with real users.

## The verdict in one paragraph

The engine is better than most of the market. Every finding cites a URL a
tool actually returned, every quote is checked against the text, verbatim
excerpts are told apart from model summary, nothing counts until a person
keeps it, and the research call sends only the company's public identity.
Several leading tools cannot say that.

The *experience* on top of that engine is the weak part:
- It reads like an audit log written for a compliance reviewer, not a
  briefing for a seller.
- It is organised by research run, not by what we know about the account.
- It never says why any of it matters to what the two of you sell, or why
  now.

The fix is less about new machinery than about turning the output into a
seller's brief. There are a few real bugs to fix on the way.

## What is good — keep it

- **Evidence discipline.** A URL must be one a tool returned, and a quote
  must appear in the text, or the finding is dropped. Source-bound excerpts
  come from the fetch tool's own `cited_text`, which is exactly the mechanical
  check the survey recommends, rather than the model's word. Most tools
  surveyed show no comparable guarantee; one third-party test found about
  30% of a big vendor's signals tied to events four or more months old.
- **A person keeps or drops each finding**, and only kept ones reach briefs,
  plans, Ask and the one-page summary.
- **The prompt is right.** It puts primary sources first, scopes facts to the
  right entity (campus vs system, parent vs subsidiary), separates installed
  from planned technology, and says "not found" instead of guessing. These
  are the three failure modes the survey names: invented, stale and
  wrong-entity.
- **Privacy is enforced in code and tests:** only the public identity, the
  question and the team's focus areas leave AWS.
- **"Still open" questions** turn gaps into discovery questions.
- **Account watch** runs weekly, with play matching done in code and no
  repeats. **Resume after a restart** works.

## What is bad

### For a first-time user (opening Research on a new account)

1. **The first thing you see is a cost form.**
   - The label reads "Full account dossier — optional area of emphasis".
   - Under "Scope of this run" there is a pre-ticked box with three lines on
     "fetch requests", "search charges" and "a floor, not a total".
   - You have no idea yet what you will get, how long it takes or what it is
     for. Cost anxiety arrives before value.
2. **"Suggested account updates" is shown on an empty account.** Its button
   is disabled, the text reads "Default selection: 0 of 0 retained findings;
   0 omitted", and the focus box is prefilled with "people technology
   strategy". It is a mystery box.
3. **No example of the output**, and no time estimate until you have pressed
   Run ("This takes a few minutes").
4. **"What leaves your AWS account" is a good disclosure in the wrong voice,
   and it is inaccurate.** It omits that the team's focus areas and the
   titles of saved notes are also sent.

### Reviewing a new note

5. **Three disclaimers stack up before the first finding:**
   - "Partial account research — coverage of extracted findings, not
     independent verification or proof…"
   - An amber "This note is a draft… Retaining a finding is not source
     verification…"
   - "The original report below is archived research, not the
     retained-evidence view. It may contain claims you excluded."

   Each is true. Together they say "don't trust this" louder than the
   findings say anything.
6. **The sticky Accept bar covers the first finding** on desktop and on the
   phone, where it also covers the title.
7. **"Model confidence: high"** is a model's opinion of itself, shown as if
   it were a fact. Meanwhile the useful facts are buried in "View supporting
   evidence": what kind of source it is, and how old.
8. **After a run, the result panel repeats the coverage grid** that the
   review shows just above. It adds "3 discovered source URLs (3 searches, 1
   fetch request)… Fetch counts are requests, not proof of successful
   reading", which is engineering language.

### Reading what we know

9. **Knowledge is organised by run.**
   - The page shows *one note at a time* ("Choose a saved note"), in
     two-column topic cards with "View all 7 →".
   - With four runs, the leadership facts are spread over four notes.
   - A seller thinks "what do we know about their leadership", not "what did
     run 3 find".
10. **"What we know" is three random findings,** one per topic in a fixed
    order. It is not the three that matter most, and not anything new.
11. **No dates where they count.** A finding's own date is in the data, but
    it is not shown on the card. The source's publication date is not
    captured at all (`page_age` is not kept), so a 2023 press release reads
    like news.
12. **Three more disclosures under every note:** "About coverage and counts",
    "Original model summary and sources (not reviewed)" and "Manage this
    note". "Adjust what this note says" opens a separate mode.
13. **The run form sits at the bottom of a full page,** under a stale result
    panel from the last run.

### Bugs found in the code

- **11 or more accepted notes break every new run.** All accepted titles are
  passed as `avoidTitles`, which the input schema caps at 10. The run fails
  with a 400, and Account watch throws.
- **Defaults disagree.** The API defaults to standard; the form defaults to
  deep.
- **Search results and the "withheld" fallback open the wrong mode.** They
  link with `?note=`, which is *adjust* mode, not reading.
- **A new run silently discards an unreviewed draft.**
- **The overview panel says "No research kept yet" while a draft is waiting.**
- **The one-page appendix prints the kept findings twice.**
- **Today's Account-watch item goes only to the first account's review.**
- **STATUS and code comments are out of date:** "two notes are open" and
  "deep is roughly twice".

## What is missing (against the best tools and good practice)

1. **Why now.** ZoomInfo's digest, Salesmotion's brief and Common Room all
   lead with a dated reason to act. Ours has no such block. Useful
   distinction: a *compelling event* has a date, an owner and a cost of
   doing nothing; a *trigger* only says something changed.
2. **So what, for us.** LinkedIn's Account IQ is testing "why your solution
   fits". Our team direction already holds what we sell (agents, AI systems,
   AI security, observability). Research is told it, but findings are never
   tagged with which of those they touch, or turned into a talking point.
3. **Dates and freshness.** The best practice is three dates per fact: when
   it happened, when it was published, and when we read it. Flag anything
   older than a set age.
4. **How strong is each source?** Rank by kind:
   1. investor relations, filings, the company's own newsroom
   2. major press
   3. trade press
   4. aggregators and resellers

   A December 2025 study found AI search favoured reseller and comparison
   pages and was wrong on B2B facts 62% of the time. A badge per finding
   would replace "model confidence".
5. **Entity lock.** Confirm the exact organisation before researching: its
   domain, ticker, headquarters, and parent or subsidiaries. Clay's own forum
   shows wrong-company results as a real failure. Our prompt asks for this,
   but nothing records or shows it.
6. **What changed since last time.** Account watch writes a fresh note.
   Crayon and Salesmotion show a *difference*: what is new, scored for
   importance with a one-line reason.
7. **Filings and earnings calls** as explicit targets:
   - risk factors that touch AI, security, power or data-centre capacity
   - risks added since last year
   - dated executive quotes on AI and capital spending

   This is where enterprise sellers find hooks.
8. **Buying-group hypotheses.** Who is likely to sign, who is likely to
   block, and where we know nobody. Framed as things to confirm in
   discovery, never as facts. This connects to People.
9. **A plan before a deep run, and progress during it.** ChatGPT and Gemini
   show an editable plan with a time estimate, then a live list of sources
   being read, and say when it is done. Ours says "a few minutes" and shows
   nothing until the end.
10. **Short by default.** One summary line per topic that expands into the
    findings (the Common Room pattern), with a cap on what the Overview and
    one-page summary show.

## The redesign I recommend

**One page that answers three questions, in this order:**
1. Why this account, now?
2. What do we know?
3. What do we still need to find out?

**At the top: the brief.** It is rebuilt from all kept findings each time
one is kept, never from a single run.
- **Why now:** a compelling event if there is one, with its date and owner,
  and the top three triggers. Each has a date and a source, or it says
  "none found".
- **Where we fit:** each of the team's focus areas with the findings that
  touch it and one "so what" line each.
- **What changed since you last looked:** new kept findings and
  Account-watch items, with their dates.

**Then: what we know, by topic, across all notes.**
- Seven short topic rows, each with a one-line summary and the newest
  finding first, expanding to the rest.
- Each finding shows its date, a source-type badge (Filing · Company ·
  Press · Trade · Other) and its age ("14 months old").
- Model confidence moves into the evidence detail.

**Then: what we still need to find out.**
- The open questions from every run.
- The buying-group hypotheses, as discovery questions.

**Running research becomes one button at the top: "Research this account".**
- It opens a short plan: what it will look for (the seven topics, plus your
  focus areas, plus filings and earnings if the company is public), about how
  long it takes, and about what it costs. One line, not three.
- You can add an emphasis and press Start.
- While it runs, a live list shows the searches made and the pages read.
- The finished draft arrives as **"New from this run: 9 findings. Keep the
  ones that are right."** There is one honest line about verification, the
  findings each have a date and a source badge, and the Accept bar sits
  below them instead of on top.

**Behind the scenes:**
- Store the source's publication date (`page_age`) and the retrieval time
  with each finding.
- Record the confirmed entity (domain, ticker, parent) on the account, and
  show it at the top of the plan.
- Ask the extractor for:
  - each finding's offering tags
  - a compelling event or trigger, kept separate
  - buying-group hypotheses as their own list
- Make Account watch's output a difference against what is already kept.
- Bring filings and earnings in as named sources where the company is
  public.

**Suggested account updates** appear only when there are kept findings, as a
single line: "Turn these into suggested people and follow-ups →". The focus
box goes.

**Disclosures:** keep one, at the foot. "What leaves your AWS account" is
written plainly and correctly.

## Order of work

1. **Fix the bugs and the honesty gaps (small):**
   - The 10-note cap.
   - Agreeing defaults.
   - Reading links.
   - Draft replacement says so.
   - Overview with a draft.
   - Duplicated appendix.
   - Today's link.
   - The disclosure's accuracy.
2. **The reading view by topic across all notes**, with dates, source
   badges and short-by-default. No model change.
3. **The brief:**
   - "Why now"
   - "Where we fit", from team direction
   - "What changed"

   This needs the extractor to tag offerings and compelling events. It is
   the biggest gain.
4. **The run experience:** plan card, live progress, review below the fold
   fixed, first-time state.
5. **Depth:** entity lock, `page_age`, filings and earnings, buying-group
   hypotheses, Account watch as a difference.

Each step can ship on its own and keeps the existing guards: the URL and
quote checks, the keep step, and nothing private going out.

## Sources (from the survey)

- **Tools**
  - HubSpot Breeze prospecting agent: knowledge.hubspot.com/prospecting/prospect-companies-with-buying-signals
  - ZoomInfo Copilot: businesswire.com (14 Apr 2025 release); docs.zoominfo.com/docs/signals-insights
  - LinkedIn Sales Navigator Account IQ: news.linkedin.com/2024/October/newAIcapabilitiesinSalesNavigator
  - Salesforce Agentforce account research (implementation guide PDF)
  - Clay Claygent: clay.com/claygent; entity-confusion thread on community.clay.com
  - Common Room: commonroom.io/playbooks/automate-account-research-with-agentic-ai
  - Salesmotion (vendor): salesmotion.io/blog/ai-account-research
  - Crayon change summaries: crayon.co/blog/webpage-summaries
- **Anthropic web search and fetch** (citations, `cited_text`, `page_age`,
  `retrieved_at`, domain filters): platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
  and …/web-fetch-tool
- **Staleness, hallucination and entity confusion as separate failures:**
  unifygtm.com/explore/ai-sales-research-hallucinated-stale-facts
- **AI search favouring reseller pages** (Dec 2025 study, via StreetInsider
  press release)
- **Methods**
  - 10-K mining: sec-api.io/resources/how-to-read-a-10-k-sec-filing
  - Compelling event vs trigger: salesmotion.io/blog/compelling-event-in-sales
  - MEDDPICC: capsulecrm.com/blog/meddpicc-sales-methodology
