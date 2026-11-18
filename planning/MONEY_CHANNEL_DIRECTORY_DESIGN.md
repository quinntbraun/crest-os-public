# Money-channel directory and inspector

November18,2026. Implements the money-channel direction in the latest end-to-end design audit. No migration, accounting rule, authority grant, balance, posting or provider integration is added.

## Interaction

A compact directory shows the saved label, linked ledger account, USD, channel type, review-record status and opening-evidence state. Each row is one accessible selection control; a selected row is highlighted. The loaded-only filter covers saved names, descriptions and account codes. Counts and additional-page availability are explicit: filtering does not claim to search unloaded records.

Desktop pairs the directory with one channel inspector and keeps the directory visible while scrolling evidence/history on sufficiently tall displays. Phones/tablets focus the selected record and provide Back to channels, preserving the current filter and original selection-button focus. An unselected desktop panel explains the task without automatically opening private records.

The inspector groups saved identity, version, effective date, masked provider reference, ownership/opening evidence and review reason. USD and the actual opening date accompany opening evidence. Copy explicitly separates saved opening evidence from a current bank balance or bank confirmation. Open/Closed describes the saved review record; no bank connection, current-funds verification or money movement is implied.

Interrupted-save checking is a secondary disclosure when no outcome is currently in review; an actual unconfirmed save has its own visible original-review task. The underlying storage/reference, fresh authorization/recovery checks, original-outcome lookup/closure and no-retry behavior remain unchanged. Editors retain their actual saved/proposed comparison. Cancelling a dirty draft asks first, declining preserves it, and accepting returns to the selected record. A dirty editor registers the standard browser leave warning; private suspension still clears in-memory records/filter/drafts. Nothing private is persisted to retain a filter.

History remains attached to its selected channel, identifies newest loaded review/earlier availability, and uses exclusive effective-period boundaries. Existing retained reasons, opening/ownership evidence and safe CSV remain. Selecting another channel clears the previous history display.

## Verification and retained failures

- `.local/design-channel-workbench-verified` failed0/2 because the new multi-channel test expected the first filter to survive an earlier deliberate page reload. Existing private-state clearing was correct; the test now explicitly reapplies its filter before testing preservation across a later save. The owned runner retained source and cleaned its cluster.
- `.local/design-channel-workbench-final` passed both complete genuine browser workflows2/2 with50 captures. Desktop visual review led to a less boxed full-row selection control.
- `.local/design-channel-workbench-polished` then failed both cases at the unchanged Axe label-content-name check: a custom accessible name omitted visible row metadata. The actual custom label was removed. Native button content now exposes all row details; an additional accessible-name assertion covers account/currency/opening context. No accessibility rule was excluded.
- Final `.local/design-channel-workbench-accessible` passed2/2 complete genuine product journeys, no skips/failures, stable tracked source and owned cleanup. Fifty runtime-bounded final-source captures and hashes are retained. Representative directory, focused-phone record, saved/proposed and sticky-history views were visually inspected, including360/390/1100/1440px cases.
- Original masked identity, eligible-account isolation, negative-opening refusal, approval validation, exact pending reference, lost-response confirmation, absent-original retirement, exact evidence and safe CSV assertions remain. Added actual two-channel creation, loaded filtering/no-match, record/history isolation, focus/filter return and dirty cancellation checks compare API request counts and actual channel-version/audit snapshots. Browsing/cancellation makes no API request or retained-data change. All five views run overflow/Axe checks at360/390/768/1100/1440px; desktop evidence review asserts the directory remains in view.
- The behavior source passed types/full lint/build and all8952 units/374 files. Final row markup/name/CSS refinements were rebuilt and both entire browser journeys passed; final types/full lint also passed before publication.

This is local directory/inspector acceptance. Long-directory pagination, additional loading/denied/stale/failed variants, final hosted source, populated upgrade, installed acceptance and physical iPhone checks remain. Other audit routes and the entire approved V1 functional objective remain active.

