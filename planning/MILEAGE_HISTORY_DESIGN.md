# Mileage records, retained history and draft navigation

November18,2026. Reconciles the latest audit's mileage and evidence-history directions against the current typed contract. No schema, transport, accounting rule, mileage calculation, allocation constraint or original-save protocol changed.

## Presentation and navigation

The current trip now leads with its saved state, distance status, departure/arrival and explicit business time zone. Current saved distance remains separate from retained history and its evidence references. Desktop keeps the trip directory beside the selected record, with sticky directory context on sufficiently tall views. Phone/tablet presents one selected trip and a Back to trips action. Unselected desktop space explains the task without opening a private record automatically.

Back keeps the selected record and unfinished forms mounted but hidden. The directory offers Return to mileage draft without making a request. Selecting another record, loading earlier evidence or saving a different correction checks for other unfinished drafts before replacing them. A declined discard retains the draft and makes no request. A standard browser leave warning covers dirty forms; private state is still cleared by the existing suspension/disposal boundary, with no new persistent draft storage. Selection, directory return and Review/Back focus use the committed DOM rather than a late animation frame.

Retained versions are shown newest first, with explicit loaded-version coverage. Actual and estimated distances remain separate, including an entered zero versus missing evidence. Each correction carries its recorded reason and readable recorded time. Adjacent-version comparisons identify exact source, movement, distance, odometer, notes and allocation changes; cross-business/trip, skipped-version and unrelated-replacement comparisons are refused. Allocation comparison includes job identity, ignores row order alone and preserves exact fractions. Full source values, UTC precision and evidence/trip/operation references remain behind native disclosures. The unchanged archive verifies and downloads only the loaded history page, its allocations and audit records.

The trip-list contract does not include customer or driven-vehicle display names. The directory uses the available trip purpose, time, state and distance status; it does not invent names, joins, mileage or a vehicle summary. Earlier-page guidance does not present an absent current record as zero.

## Verification

- Final owned `.local/design-mileage-history-diagnostic` run passed all six genuine product journeys in Chromium/WebKit, with no failures, skips or cancellations, stable tracked source and owned-cluster cleanup. This includes both departure-correction journeys, both job mileage journeys and both standalone-travel journeys.234 runtime-bounded five-width captures and byte hashes are retained; representative phone correction/history and desktop/narrow-desktop views were visually inspected.
- Original departure/arrival, saved correction, exact fractional attribution, over/under-allocation refusal, one submitted save, WebKit lost-response recovery, formula-leading CSV text, verified CSV/JSON ZIP, allocated-job return and refused-download assertions remain.
- Added checks cover Back/draft return with retained values and shares; declined record switch and cross-draft save with no API request or actual mileage/travel/audit changes; accepted discard before another correction; delayed-frame focus release; and before/after saved evidence disclosure without a request or database change. All configured accessibility checks use the full Axe result at360/390/768/1100/1440px, with overflow and attribution-control geometry assertions retained.
- Five focused presentation units cover explicit zero versus missing distance, source changes, scope/gap/replacement refusal, changed job identity, allocation row order and exact notes/odometer precision.
- Full source types, lint, production build and all8973 units/378 files passed. A strict tracked-source secret scan retained the default rules and scanned35.98MB with zero findings.

## Retained failure and remaining acceptance

The initial `.local/design-mileage-history-verified` run passed5/6. Chromium's main mileage journey timed out waiting for Review trip mileage after returning to the saved job following arrival, before opening the mileage editor. Its source snapshot, result and208 runtime-bounded captures remain. The same journey passed on the final run after test-only failure observations were added; this does not establish a root cause or a production transport fix. Failure-only observations retain a synthetic screenshot and bounded fixed-endpoint/status/control-presence facts, with no response body, URL query, credentials or arbitrary error message. The original failure still fails its test; no retry or application guard was weakened.

This proves the local mileage history/navigation refinement, not all empty/loading/denied/stale/large-pagination states, a preserved installed upgrade or physical iPhone behavior. Full exact-source release/native-format verification, delivered review, the other November17 audit findings and completion of the approved V1 functional scope remain required. Installed schema109 is unchanged.
