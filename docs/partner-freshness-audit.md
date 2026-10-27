# Partner-change freshness

Implementation notes, not a release receipt. The merged PR carries exact-head verification and release evidence.

## Contract and scope

On account overview and meeting/deal/contact/play detail pages, a bounded authenticated metadata poll detects account history advancing. A quiet generic notice appears; no automatic refresh, save, provider call or person attribution. Polls run every 25 seconds while visible and on focus/visibility return. Cursor comes from the server-rendered layout, not the first poll. Malformed/failed/late replies cannot retire a known notice.

Refresh is explicit. Only fresh server props acknowledging the observed cursor clear the notice. Notes drafts and brief handoffs retain their original content and version/fingerprint; existing conflict/reconciliation rules remain authoritative. Clean notes adopt explicitly refreshed data.

Open quick-deal and follow-up editors defer refresh, since a partner might archive their row. Generic ActionForm defers while dirty, saving or refused; an untouched initially-open form does not block. Embedded proposal reviews defer while saving, holding unknown outcomes or selected source acknowledgements. Holds are unique per component instance.

Research/review/import/spreadsheet/summary routes do not receive this new poll/notice/refresh control. Their existing workflows are unchanged. This bounded slice does not claim general-purpose preservation across navigation, manual browser reload or unrelated server-action refreshes.

## Design

Account-scoped COUNT/MAX(rowid) over append-only change_log avoids same-millisecond timestamp ties. Endpoint is authenticated, metadata-only and no-store. No migrations, dependencies, localStorage draft copies or presence system.

## Verification

Synthetic tests cover endpoint auth/scoping, cursor ties, malformed-first-poll recovery, two real browser sessions, no unsolicited RSC refresh, dirty notes plus actual save conflict, retained brief identity, deferred editors, partner archive, unsupported routes, and the scheduled timer. Optional E2E_ARTIFACT_DIR writes synthetic desktop/mobile captures. Independent review found disappearance and research-remount risks; corrections add holds and restrict scope. Final test/re-review results and limits belong in the PR release receipt.
