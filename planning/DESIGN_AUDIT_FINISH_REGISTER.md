# Design-audit completion register

Current owner objective (November17): implement all findings in the most recent design audit, the November17 end-to-end review of36 destinations,20 embedded workflows and14 shared findings. Earlier audit cycles remain supporting evidence. Each current finding requires a concrete implemented result and relevant verification; neither an audit report nor a green narrow test is the complete deliverable. Conditional design suggestions must follow existing authorized data contracts and approved V1 scope.

The original local `Crest OS Design Audit` and `Crest OS Second Design Audit` retain screenshots and implemented refinements. The November17 end-to-end review adds 36 route entries,20 deeper-state references and14 shared findings. Its proposals must be reconciled with current source: an older screenshot is not proof of a present defect. In particular, customers, vehicles, addresses and services already have focused phone-record layouts, and quotes already have Edit/Preview modes and saved-total controls. Preserve and extend those patterns instead of rebuilding them.

## Shared findings and acceptance

| ID | Requirement | Current evidence / remaining work |
|---|---|---|
| S01 | One delivered design/build | Development source differs from installed schema109. Exact-source release, preserved upgrade and final installed captures pending. |
| S02 | Purposeful desktop composition | Existing directories/inspectors implemented; unselected states and wider working layouts require further visual review. |
| S03 | Focused phone records | Customers, vehicles, addresses and services already implemented in source. Quote directory/detail separation is now implemented locally, with unsaved-draft resume, origin focus and retained search. Hosted commercial verification passed all56 cases on public64ea40d0; full release remains gated. See QUOTE_PHONE_NAVIGATION.md. Recheck all at required widths and on a physical phone. |
| S04 | Predictable action hierarchy | Several per-domain toolbars improved. Review reload, recovery and commit emphasis in configured deeper states. |
| S05 | Less nesting | Receipt cards and multi-portion completion improved. Completion removes enclosing scope/vehicle boxes, uses simple portion dividers and aligned amount groups; review now targets the invalid portion field. Both complete genuine browser journeys passed with five widths and retained financial/recovery assertions. See COMPLETION_DESIGN_REFINEMENT.md. Accepted-quote/history still needs review. |
| S06 | Complete state design | Prior72 captures cover one state per destination, not all required states. Fresh loaded/empty/loading/denied/stale/uncertain/success coverage remains. |
| S07 | Financial scope with totals | Shared headers now group period, currency, true snapshot time, coverage and downloads across trial balance, balance sheet, income, funds and aging. Four current-source genuine journeys passed in Chromium/WebKit with exact financial/CSV assertions and four widths; measured nested-heading overlap and account-to-journal return are covered. See REPORT_SCOPE_DESIGN.md. Full release/installed acceptance pending. |
| S08 | Legible Crest identity | Owner logo present in development. Original small-size/vector asset preparation and delivered consistency remain. Do not replace logo with an invented mark. |
| S09 | Consistent vector navigation | Five shared SVG destinations implemented locally. Four local browser cases passed (receipt and complete signed-in customer/vehicle journeys, Chromium and WebKit), with stable source and owned-resource cleanup. Fresh customer/shell captures were visually inspected. Exact-source release and physical-device acceptance remain pending. |
| S10 | Type/spacing/numeric rhythm | Shared CSS exists; verify actual fonts and inspect all configured views before diagnosing fallback-font defects. |
| S11 | Useful motion | Short transitions, loading skeletons and reduced-motion rules exist. The Today opacity fade was proven to lower entry-frame contrast in both browsers and replaced by movement with fully opaque text. Both full scheduling journeys passed with the first-frame regression; see TODAY_ENTRY_CONTRAST.md. Continue other state-specific layout stability/focus checks; no fake progress. |
| S12 | Readable evidence history | Multiple dated interval/approval/travel views improved. Consistent event summaries and comparisons still need review. |
| S13 | Preserved navigation context | Contextual Back/focus rules implemented for several domains. Quote selection/list restoration and planner variants need verification. |
| S14 | Physical phone finish | Emulated WebKit evidence exists. Physical iPhone keyboard/safe-area/file/field journeys remain unverified. |

## Route coverage retained

All35 normal destinations and the missing-page state remain in scope: sign-in; Today; customers; customer CSV review; addresses; vehicles; leads; lead sources; services; quotes; quote amendments; appointment proposals; schedule/saved job; booking; change appointment; service arrangements; standalone travel; mileage; work status; completion; interruption; cancellation; work-time; expenses; exports; settings; accounting; money channels; dated mappings; mapping approvals; category mappings; category approvals; tax; Calendar; missing page.

Embedded flows remain in scope even without a dedicated route: customer/vehicle profiles and links; planner views; quote editing, preview, sharing and acceptance; amendments; partial multi-vehicle completion; completion follow-up; custody/photos; work-time corrections; receipt validation/view/download; trial balance, balance sheet, income, funds and aging; invoice issuance, payment/correction/credit/refund; statement staging/matching; supplier original/payable review; opening worksheet/receivables; dated approvals/history; Calendar waiting/failure/confirmed states; export request/download/recovery.

## Current release dependency

Private receipt preview composition is documented in SYNTHETIC_RECEIPT_PREVIEW.md. Existing screens must be backed by their real tested transport before they count as ready. All19 prerequisite jobs passed for preceding public head8a1682294db14af975e56adf3d5245ae2db3a6c2, but Foundation checks failed its unchanged dependency-audit gate on GHSA-fc5q-39xc-vjpf. No patched registry release was available when checked November17. The full gate remains required; do not install this candidate as accepted.

Latest public64ea40d0 run44191675618 also passed all19 prerequisites, including56 commercial cases, then failed Foundation checks at the same required dependency security gate (job134439344472). A later screenshot artifact absence followed the skipped build; it is not a second established application defect. The full gate remains intact.

Report source960312e9 run44197656572 finished with17/19 prerequisites passing. Schedule job134443214948 failed one WebKit contrast case (20/21 cases passed); the first-frame fade cause is reproduced and fixed locally with both full journeys passing. CRM job134443215493 separately failed WebKit Save vehicle remaining disabled. Foundation job134456324424 correctly failed the prerequisite gate and did not reach dependency audit. Quote feedback and owner-expense workflows passed. No acceptance is transferred to later completion/contrast code.

Next sequence: investigate the disabled WebKit vehicle save without weakening validation/access checks; continue readable histories and unselected desktop layouts in coherent changes; finish full four-format receipt-worker verification and all exact-source checks; preserve and verify the installed upgrade; inspect the delivered build and physical phone before final sign-off.
