# Tax profile workbench

November18,2026. Implements the tax-profile direction in the November17 end-to-end audit without changing tax authority, pricing, posting, API contracts or approval rules.

## Interaction and composition

A responsive workbench keeps jurisdiction/service-or-tip selection together and places retained approval history beside it at desktop widths. Phones keep a single ordered flow. The selected jurisdiction and applicability are repeated as explicit context; neither a location nor a default rate is inferred. There is no authoritative jurisdiction directory in the current contract, so the existing explicit entry remains.

The read-only USD amount check keeps its entered amounts and verified result in the same disclosure, separate from approval. Actual saved profile version, effective date and rate remain visible. Calculation method exposes the actual entered gross/discount and existing integer-cent rule: inclusive net is divided by one plus rate and rounded half up to cents; included tax is the remaining difference. Verified non-taxable calculations state the distinct zero-tax treatment. Unresolved/exemption states retain their existing refusal/evidence behavior. No calculation or financial write implementation changed.

History identifies the newest loaded approval rather than claiming it is universally current. Earlier rows end before the next loaded effective date, explicitly exclusive. Loaded count and earlier-page availability remain honest; verified empty history is distinct from an unverified read. CSV contents, evidence and reasons are preserved.

The existing approval editor reports idle/editing/pending/busy state to the selection controls. An active draft or unresolved original approval prevents changing scope and unmounting the task. Cancelling a nonempty draft asks before discarding it; declining preserves all draft values. Cancellation sends no API request and does not change saved profiles or audit history. Retained uncertain-operation lookup/closure, recovery fences, fresh authorization, private suspension clearing and no-retry rules remain unchanged.

## Verification and limits

- Initial owned run `.local/design-tax-workbench-verified` failed both browser cases because the new geometry assertion incorrectly required retained history after a deliberately refused calculation clears unverified results. Source remained stable and owned cluster cleanup succeeded; the production clearing behavior was preserved.
- Corrected complete Chromium/WebKit journeys in `.local/design-tax-workbench-final` passed2/2, with30 runtime-bounded captures. Visual inspection then found the global three-column fact layout squeezed service names at1100px inside the narrower workbench pane.
- Final `.local/design-tax-workbench-responsive` passed both complete genuine product journeys2/2, no skips/failures, stable tracked source and owned-resource cleanup. Thirty final-source captures are retained with byte hashes in its capture-manifest.json. Representative phone/desktop captures, including the corrected1100px WebKit and1440px Chromium previews, were visually inspected. Context-cell minimum readability, desktop side-by-side geometry, Axe and no horizontal overflow are checked at360/390/768/1100/1440px.
- Original exact-rate tampering rejection, discount boundary, dates, scope, safe CSV, approval validation, lost-response/original confirmation and absent-original retirement assertions remain. Added draft-cancellation checks compare actual tax-profile/audit database snapshots and request counts; editing and pending scope locks are asserted.
- Type checking, full lint and production build passed for the behavior change; all8952 units/374 files passed. The final refinement changes only the context facts class/CSS and browser geometry assertion; its production build and both complete browser journeys also passed.

This establishes the local tax workbench refinement. It does not establish all long-history pagination, denied/stale/loading variants, exact-source hosted release, installed upgrade or physical iPhone acceptance. Synthetic approvals do not activate production tax settings. Other audit routes and approved V1 functional completion remain in scope.
