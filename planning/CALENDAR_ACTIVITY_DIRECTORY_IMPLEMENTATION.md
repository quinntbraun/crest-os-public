# Calendar appointment directory: existing-source read boundary

November 19, 2026. Continues the original R34/D19 activity-list requirement under approved V1 Calendar scope. This document records an implementation decision and partial code, not a completed visible directory or release acceptance.

## Decision

Reuse the existing typed, authorized `scheduling.workspace`, `scheduling.list` and `readSyntheticCalendarJobStatus` readers. The existing list already provides scoped saved appointment identities, customer labels, dates, time zones and appointment sequences with a bounded cursor. The Calendar reader already returns current sync state and acknowledged confirmation evidence. A new database migration, API endpoint, arbitrary SQL query, new grant or vendor connector is unnecessary for this directory. This does not activate live Google Calendar; the current Calendar runtime remains explicitly fictional and test-gated.

`src/client/calendar-activity.ts` now composes these original readers into a bounded page that is delivered only after its authority checks:

- Read at most five appointments per page using actual business-local date boundaries and the existing date-window validator. The initial window is the business date minus 30 days through plus 30 days; this is a presentation default, not a business policy or completeness claim. Explicit filters must remain available in the finished UI.
- Require the Calendar feature and ready recovery epoch before reading the list. Bind paging to business, operator authority binding, recovery epoch, business time zone and the exact selected date range. Use the actual last returned start/ID for the next cursor.
- Read each current status sequentially with a combined 40-second page deadline and cancellation. An individual failed status read remains unverified, never an inferred waiting or success state. No automatic retry or unbounded all-page fetch occurs.
- Require each status's job identity and appointment sequence to match its listed appointment. The SQL status field is the appointment sequence, not the mutable job version. If it changed, refuse the page rather than showing confirmation against a different visit time.
- Recheck session and workspace authority after all status reads, before handing any private rows to the view. A revoked or changed binding, business, operator, time zone, epoch, recovery state or feature refuses the page. Cancellation cannot become a partly verified result.

All calls remain reads through their original server-side authorization, private-response and request-admission boundaries. No booking, proposal, consent, dispatch, posting, audit-history or credential-storage behavior is added. Presentation cursors must remain private in-memory state; do not serialize session bindings or recovery authority into URLs or browser storage to implement navigation.

The readers do not share a database snapshot. Each status is checked during the page load and bound to its listed appointment sequence; this must not be labelled an atomic database snapshot or complete provider history. The UI must qualify its date/page coverage and offer an explicit reload.

## Verification so far

Type checking, focused lint and nine focused unit cases pass. The tests use the existing parsed booking-list fixture and cover business-local default dates, bounded requests and actual next-row cursor, initial recovery mismatch, a failed row without false success, failed final authorization, changed final binding, appointment-sequence mismatch, cancellation and invalid dates. The first type-check attempt found a prohibited constructor parameter property and an unparsed fixture return type; these were corrected to the repository's erasable syntax and existing list parser before the passing run.

These are client-boundary unit checks with injected readers, not genuine provider, database, browser or full application acceptance. The previous 9,005-case full suite belongs to the earlier Calendar selected-row source; it is not relabelled as a fresh full run including this new module. No visible page imports the new reader yet.

## Required next implementation

Wire a visible date-filtered, paginated appointment activity list with actual labels and current-state rows. Preserve the selected inspector, list filters/page/scroll and keyboard focus through phone selection/return and browser navigation, without weakening private clearing on hide, logout or context changes. Expose per-row failed reads honestly, qualify incomplete page/range coverage and retain the prominent fictional/no-events label. Do not manufacture chronological provider events from the current-state response.

Add genuine signed-in fixtures for multiple actual accepted/booked appointments and pagination, including an appointment changing during a read, failed/paused reads, cancellation, retry, reload, selection/return and unchanged source/audit data. Inspect dense phone/desktop states and every original audit requirement before closing R34/D19. The separate D02 planner baseline also still needs genuinely dense/overlapping data; its existing month-capture journey shows only one loaded visit.

## Release continuity

Published quote/recovery source `40481a44463b250b30eb07a1768c7f0be83b5539`, Phase 1 run `44477596051`, reached terminal results: 20 of 22 jobs succeeded. Accounting-settings `135401791574` expired during both bounded signed Ubuntu browser-dependency attempts, before product build/tests. Dependent Foundation `135413789547` then failed the mandatory all-prerequisite guard; later gates were skipped. Neither failure proves an accounting UI assertion failed, nor a successful native release. All original results are retained.

A failed-jobs-only same-source infrastructure retry was requested after every original job was terminal. Source, timeouts, package signatures, required groups and assertions remain unchanged. Observe the actual retry response and jobs; a request is not a passed retry or a proven cause/cure. Preserve this verification through its terminal results before publishing replacement source. The locally verified selected-row Calendar commits remain unpublished; installed schema 109 and all actual-use, export/recovery, physical-device and owner gates remain unchanged. Full audit and unfinished approved V1 work remain active. $0 new spending.
