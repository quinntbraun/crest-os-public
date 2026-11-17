# Design-audit completion register

Objective: implement the original design audit, perform a separate review, implement its remaining findings, and verify the finished visual product. Neither an audit report nor a green narrow test is the complete deliverable.

The original local `Crest OS Design Audit` and `Crest OS Second Design Audit` retain screenshots and implemented refinements. The November17 end-to-end review adds 36 route entries,20 deeper-state references and14 shared findings. Its proposals must be reconciled with current source: an older screenshot is not proof of a present defect. In particular, customers, vehicles, addresses and services already have focused phone-record layouts, and quotes already have Edit/Preview modes and saved-total controls. Preserve and extend those patterns instead of rebuilding them.

## Shared findings and acceptance

| ID | Requirement | Current evidence / remaining work |
|---|---|---|
| S01 | One delivered design/build | Development source differs from installed schema109. Exact-source release, preserved upgrade and final installed captures pending. |
| S02 | Purposeful desktop composition | Existing directories/inspectors implemented; unselected states and wider working layouts require further visual review. |
| S03 | Focused phone records | Customers, vehicles, addresses and services already implemented in source. Quote directory/detail separation is now implemented locally, with unsaved-draft resume, origin focus and retained search. Current combined browser acceptance remains open; see QUOTE_PHONE_NAVIGATION.md. Recheck all at required widths and on a physical phone. |
| S04 | Predictable action hierarchy | Several per-domain toolbars improved. Review reload, recovery and commit emphasis in configured deeper states. |
| S05 | Less nesting | Receipt cards improved. Multi-portion completion and accepted-quote/history still need a coherent pass. |
| S06 | Complete state design | Prior72 captures cover one state per destination, not all required states. Fresh loaded/empty/loading/denied/stale/uncertain/success coverage remains. |
| S07 | Financial scope with totals | Report headers and scoped downloads improved. Preserve every coverage warning; assess all configured reports together. |
| S08 | Legible Crest identity | Owner logo present in development. Original small-size/vector asset preparation and delivered consistency remain. Do not replace logo with an invented mark. |
| S09 | Consistent vector navigation | Five shared SVG destinations implemented locally. Four local browser cases passed (receipt and complete signed-in customer/vehicle journeys, Chromium and WebKit), with stable source and owned-resource cleanup. Fresh customer/shell captures were visually inspected. Exact-source release and physical-device acceptance remain pending. |
| S10 | Type/spacing/numeric rhythm | Shared CSS exists; verify actual fonts and inspect all configured views before diagnosing fallback-font defects. |
| S11 | Useful motion | Short transitions, loading skeletons and reduced-motion rules exist. Complete state-specific layout stability/focus checks; no fake progress. |
| S12 | Readable evidence history | Multiple dated interval/approval/travel views improved. Consistent event summaries and comparisons still need review. |
| S13 | Preserved navigation context | Contextual Back/focus rules implemented for several domains. Quote selection/list restoration and planner variants need verification. |
| S14 | Physical phone finish | Emulated WebKit evidence exists. Physical iPhone keyboard/safe-area/file/field journeys remain unverified. |

## Route coverage retained

All35 normal destinations and the missing-page state remain in scope: sign-in; Today; customers; customer CSV review; addresses; vehicles; leads; lead sources; services; quotes; quote amendments; appointment proposals; schedule/saved job; booking; change appointment; service arrangements; standalone travel; mileage; work status; completion; interruption; cancellation; work-time; expenses; exports; settings; accounting; money channels; dated mappings; mapping approvals; category mappings; category approvals; tax; Calendar; missing page.

Embedded flows remain in scope even without a dedicated route: customer/vehicle profiles and links; planner views; quote editing, preview, sharing and acceptance; amendments; partial multi-vehicle completion; completion follow-up; custody/photos; work-time corrections; receipt validation/view/download; trial balance, balance sheet, income, funds and aging; invoice issuance, payment/correction/credit/refund; statement staging/matching; supplier original/payable review; opening worksheet/receivables; dated approvals/history; Calendar waiting/failure/confirmed states; export request/download/recovery.

## Current release dependency

Private receipt preview composition is documented in SYNTHETIC_RECEIPT_PREVIEW.md. Existing screens must be backed by their real tested transport before they count as ready. All19 prerequisite jobs passed for preceding public head8a1682294db14af975e56adf3d5245ae2db3a6c2, but Foundation checks failed its unchanged dependency-audit gate on GHSA-fc5q-39xc-vjpf. No patched registry release was available when checked November17. The full gate remains required; do not install this candidate as accepted.

Next sequence: finish local receipt/launcher verification; complete current-source combined quote acceptance and diagnose access/replacement failures without weakening safeguards; continue the remaining state/layout findings in coherent changes; execute all required exact-source checks and preserved upgrade; inspect the delivered build and physical phone before final sign-off.
