# Product-workflow slice: validation record

## Implemented scope

This candidate builds on the separate persona-usability foundation (PR #24, `363d14ef33fbee96d4f4ab6b15c3405bc32e7799`). It follows `product-workflow-slice-plan.md`; that document records the pre-implementation plan, not current branch status.

- Today presents a deterministic next task and distinct meeting, proposed-change and due-work queues. Reasons use recorded timing/work, with no importance score. Due today is separate from strictly overdue; play next steps are not relabeled as follow-ups. A meeting selected as the primary task is not repeated as a supporting preview.
- Account entry presents the contextual action through the existing two-column overview, with real routes/forms for sparse and new accounts. Research, Plan, history and record creation remain available.
- Meeting focus follows pending review, scheduled preparation, notes gaps and open follow-through, with explicit anchor choice taking precedence. The notes editor and panel order stay mounted through refreshes. No meeting-completion status or automatic phase mutation was introduced.
- Saved follow-up rows expose exact assignee-scoped work-list links. Retained follow-ups on archived accounts do not link to queues that exclude them. Source-meeting association, CAS, explicit proposal decisions and stale-write guards remain unchanged.
- Activity uses conservative event descriptions with exact recorded fields and history behind them. Sparse brief entry fields are compacted without deleting populated content, source material or uncertainty.

No schema migration, dependency, provider-route, budget, pipeline-column or research-dossier redesign. No live provider calls or customer data in verification. No deployment is authorized by this record.

## Review and repair

An independent Astra source review examined all 13 changed/new production files. It found two bounded P2 defects: account notes eligibility across midnight and archived-account follow-up destinations. Both were reproduced by regression tests that failed before repair and passed afterward. The independent delta review passed; all 13 final production hashes were matched by the integrator. The reviewer did not claim to execute browser gates.

GLM-5.3, through the existing coding-plan subscription, reviewed 16 rendered DOM/geometry states. The integrator separately inspected screenshots. GLM judged the workflow materially improved, with small corrections rather than a structural redesign:

- Due-work view-all links now state the full count.
- Follow-up row Edit/Archive hit areas are enlarged on narrow screens, without changing their actions.
- Singular pending-change wording corrected.
- The suggested same-day-meeting warning expansion was not adopted without evidence: task selection uses recorded chronological order, not a coin flip. The actual primary meeting page retains its same-day warning and explicit irreversible-merge disclosure. A second warning on Today would duplicate it and treat ordinary same-day meetings as a defect.

A real browser first-fold regression was fixed, not waived: remove the repeated primary-meeting preview, put proposed changes before the supporting meeting list, reduce mobile primary spacing, and remove the generic explanation that repeated the recorded reason. The original 390/320 first-viewport assertions now pass.

## Execution evidence

- Full local unit run: **90 test files, 1,034 tests passed**. Subsequent spacing-only changes are also covered by the final production build and browser first-glance run; exact-head CI must pass before release.
- Production build, typecheck, privacy and `git diff --check` passed.
- Read-only baseline and initial candidate: **48 distinct page/viewport states each**, with no page overflow or runtime errors. Business-table fingerprints unchanged across the initial candidate capture. A final post-repair capture is retained separately by the operator.
- Full 24-flow local run exposed obsolete copy/link assertions and the mobile first-fold regression. Changed expectations preserve numeric pending-work visibility, exact unassigned scope, and bounded unique preview records. No mutation/conflict/approval guarantee was weakened.
- Re-run import/review, weight, layout, post-meeting and handoff flows passed; a fresh final first-glance run passed after the mobile fix. Full exact-head CI remains the final all-flow assertion, rather than treating a mixed local run as a clean full run.
- An additional **24-check synthetic task journey** verified account scope, Back, dirty-note survival at three widths, save-only without proposals, reload, fake extraction awaiting explicit review, individual accept/reject, retained source meeting, owner/date persistence, and navigation through the actual assignee-correct link. Zero pending proposals still leaves open work.

Detailed scripts, failed attempts, screenshots, review receipts and logs are retained outside the repository in the operator evidence directory `strategy-workflow-20260924`. Synthetic records and fake AI validate application behavior, not live extraction quality or human-user usability. Final PR checks must be read back against the exact candidate SHA. Merge and deployment remain separate decisions.
