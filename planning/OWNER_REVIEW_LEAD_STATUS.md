# Lead status in the visible owner review

2026-10-27. Working review 05 connects the existing lead status controller, transport and shared row/command/history contracts to the fictional review store. The shared lead screen places status controls above the long intake form so routine progress updates need less scrolling. Dirty intake, pending-operation and cross-panel locks remain unchanged.

Manual transitions are exactly the existing BR02.2 targets: new, contacted, awaiting information, quote needed, follow up and lost. Lost and reopening Lost/Won require a meaningful retained reason. Quote sent and Won remain unavailable through this command; no quote, acceptance, conversion, invoice or accounting event is implied. This changes no business rule, database schema, dependency or production activation.

Each review status save validates the command, current version, source state, resulting lead, immutable state event and original receipt before changing memory. It retains a state-change lead audit and a separate create audit for the immutable event. Intake, attribution, estimate and follow-up stay unchanged. Exact original replay returns its receipt after later changes; an altered original or cross-workflow operation identifier conflicts. Stale, malformed and unauthorized changes leave both record and evidence unchanged.

Snapshots include lead-state-events rows and their create audits. Restore checks the shared event contract, parent lead, version/operation uniqueness, audit binding and agreement with the lead state-change history. Missing, rewritten or detached evidence is refused. Older snapshots without any status changes remain readable. Reset clears the new evidence and invalidates earlier recovery epochs. This is temporary sample storage with explicit development snapshot preservation, not production durability or a full backup.

## Executed checks

All 15 real HTTP preview cases pass, including four status groups covering mixed intake/status history, paginated version gaps, original receipt replay, lost/reopen reasons, restore corruption, invalid commercial targets, stale source/version, authorization and reset. All 197 focused lead controller/contract/client cases in three files pass. Type checking and focused lint pass. Earlier full-suite and native release evidence remains separate; no new full release acceptance is claimed.

Actual browser review changed the sample interior-detail inquiry from new to contacted, then lost and follow up. Both reason-required saves were disabled before a reason was entered; search hid the lost lead until Include lost leads was chosen. Both earlier reasons remain visible after reopen. The updated status panel appears before intake; the 360px review has a 345px document width, with the viewport restored afterward. UI builds and all 15 tests left the owner's running data intact; test assets stayed isolated (served JavaScript hash unchanged).

Current fictional records and histories were validated and preserved before the backend restart and again after browser testing: five customers, one address, two vehicles, two leads, two sources, two vehicle links and three lead state events. No real data, payment, paid service, signup or owner location permission was used.

Next prioritize visible workflow feedback and a supported database-backed sample installation. Reported lead vehicles, lead locations and conversion remain disconnected in this review; scheduling, quotes, invoices, expenses, financial reports and Google Calendar remain ahead. Real Crest use remains gated. Whole-V1 coding percentage and active-hour estimates remain withdrawn until the remaining workflow inventory supports a useful estimate.
