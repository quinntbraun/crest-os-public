# Issued invoice document and draft selection

November18 follow-through for the issued-invoice finding in the November17 end-to-end design audit.

The immutable issued document now has its own reading surface, invoice number, Issued/currency label, prominent Original total, customer, actual issue/due dates, included tax and unchanged line amounts. Payment, correction and refund tasks sit outside the document. Existing capability flags still control the available actions. The Payments anchor is also available when payments are the only enabled action; it moves keyboard focus without loading or posting anything.

Draft evidence remains available behind Review draft history after issuance. Unissued draft facts, editing, cancellation, earlier versions and CSV downloads remain accessible. The keyed tax/issue component occupies a stable position before the draft evidence, preserving its locally confirmed issued result when the parent receives the issuance callback.

The issued read contract provides an immutable original total, not a current outstanding balance. This screen labels that amount Original total and does not infer Paid/Unpaid, a live balance or a receipt outcome. Existing payment tasks continue to load their own authorized balances. A separately verified outstanding header remains a further refinement; no new financial rule or inferred amount is introduced here.

## Reproduced selection defect

After opening an issued invoice, choosing New invoice draft and saving an empty nonposting draft retained the previous `openedInvoice` in the selected draft view. A genuine Chromium regression failed at the old Issued invoice region still being present after the real new-draft save and read returned200. This was a display identity defect, not evidence of an incorrect posting. The negative run is retained at `.local/design-invoice-selection-negative-owned`, with source stability, owned-cluster cleanup and11 surviving runtime-bounded captures.

Entering an authorized draft editor now clears the selected issued document and issued-draft marker. It does not alter invoice records, draft operations, interrupted-save references, accounting calculations or posting logic. Existing pending-operation checks and write-state checks still precede entry.

## Verification

- The initial document layout passed four complete genuine invoice/job-completion journeys before the new identity regression was added. Seventy-seven surviving runtime-bounded captures from that run are retained separately; overwritten screenshots are not attributed to it.
- Final `.local/design-invoice-selection-final` passed all four complete Chromium/WebKit invoice and End Job journeys, zero failures/cancellations/skips, with stable source and owned PostgreSQL cleanup. Ninety-two runtime-bounded final captures and SHA-256 manifests are retained.
- The final invoice journeys cover genuine taxable and complimentary lines, owner numbering/period setup, interrupted issue recovery, a single issue submission, invoice CSV and payment entry. Original assertions remain. At360/390/768/1100/1440, full Axe and overflow checks pass. Draft-history keyboard disclosure and the Payments anchor require zero business requests and unchanged actual invoices/journal entries/journal lines/audit rows.
- The new identity regression saves an actual empty draft, requires no issued region, visible empty draft facts and its Edit action, checks full Axe/overflow at390/1440, then reloads and reopens the original two-portion issued draft. Actual invoices, journal entries and journal lines remain identical across the save and reopening. The legitimate draft-save audit is allowed to be recorded; it is not falsely claimed unchanged.
- Types, full lint and production build passed after the application fix. The final screenshot-only test addition also passed focused lint. Full unit results are recorded in the working state and local verification logs.

This proves this local invoice refinement and the exercised workflows. Other invoice states, payment corrections, large histories, the complete audit, approved V1 functionality, exact-source release gates, populated upgrades, native-file worker checks, installed review and physical iPhone acceptance remain open. The installed schema109 release is unchanged. No schema/API/dependency changes or new spending.
