# Expense directory and selected purchase

November17, 2026. Implements the latest design audit's expense list/inspector refinement using existing expense and receipt contracts. Synthetic development only; no schema, accounting rule, permission or installed-preview change.

## Result

Desktop uses a searchable purchase directory beside one selected purchase or correction form. Below1100px the selected purchase replaces the directory, with an explicit Back to expenses action. Directory entries retain description, amount, paid date, vendor, category and written record/receipt state. Saved details include vendor, payment method, reference and notes. A read does not auto-select a private record to fill the inspector.

The selected-record and return controls restore keyboard focus. Returning to the list keeps its query and existing list DOM; the initiating row receives focus when still present, otherwise search/add is the fallback. Selection changes no business records. Original save acknowledgment/recovery may select the acknowledged expense; it does not replay the save. Correct or void remains secondary. Messages describe the current view rather than leaving an Editing message after cancellation or Back.

## Draft, file and privacy boundaries

- Filtering affects directory entries only. All loaded purchase/receipt tasks retain their keyed component instances; hiding another record does not discard its chosen file or pending request.
- The receipt viewer closes/revokes its private preview on hiding, while the selected file and original request remain in memory. Existing page-hide/session privacy clearing remains authoritative.
- Changing record with an unfinished correction requires explicit discard; dismissing the confirmation preserves entered values. Selecting the same record focuses the current draft.
- A receipt task in progress pauses correction of that purchase. Switching records preserves the task. Clearing the selected file re-enables correction when otherwise eligible.
- Reloading expenses warns about unfinished receipt tasks. Leaving the page warns for a selected file, pending receipt attachment or resume. No receipt bytes or correction draft are added to browser storage.
- Receipt summaries are derived from actual child state: unchecked, explicitly checked empty, pending validation, available or active task. There is no new automatic receipt-list read and no inferred attachment from a file selection.
- Existing save/reference, correction, void, immutable posting, original upload, receipt recovery and CSV paths remain unchanged.

## Executed evidence

The isolated owned-cluster runner snapshots tracked source bytes and Git identity before/after and removes only its owned test cluster. No source or Git state was changed while a runner was live.

1. `.local/design-expense-directory-verified`:5/9 passed;4 failures retained in its log and source snapshot. Two new journey failures came from toggling an already-open optional vendor disclosure closed before filling it. The test now opens it only if the actual field is hidden. Separately, WebKit journal drill-down did not find the expected row and another fixture failed migration setup before opening its receipt page. Those two causes are not established by subsequent success; no business/security/migration guard or assertion was relaxed.
2. `.local/design-expense-directory-final`:9/9 passed, zero failures/skips, source stable and owned cleanup confirmed. Eight genuine product cases plus the existing UI fixture include posting/recovery, receipt viewing/original bytes, directory continuity, lost expense reply, correction, void, export and private-state clearing in Chromium/WebKit.46 captures from that runtime are retained with hashes. Visual inspection then found a stale Editing message after cancellation and an unnecessarily wide correction action.
3. `.local/design-expense-directory-aligned`:5/5 passed on the final message/action source, zero failures/skips, source stable and owned cleanup confirmed. Four genuine owner-expense cases plus the existing UI fixture.28 runtime-bounded captures are retained with hashes. This final scoped run does not claim to rerun the separate financial posting/receipt cases from step2 after the message/CSS-only refinement.

The new two-record genuine journeys assert selected-file bytes metadata remain in the file input across filtering/selection/return; actual empty versus unchecked receipt summaries; correction cancellation and retained draft values; same-record focus; phone list/detail and desktop split at360,390,768,1100,1440px; Axe/overflow checks; privacy clearing; zero API requests during navigation/unsaved interaction; and identical expense, receipt and audit snapshots after the two explicit initial saves. They use fictional purchases and do not upload the selected file.

Failure-only diagnostics retain a bounded rolling32 fixed-route/status/transport events, plus existing redacted session admission/provider categories. They include no response body, credentials, customer values or record identifiers, and perform no rejected-login or write retries.

Final production build, type checking, full lint and all8,949 unit cases/373 files passed. Strict source scan passed with no findings across35.81MB of scanned source; its private local report is `.local/design-publication/expense-directory-strict-secret-scan.json`.

## Remaining acceptance

This completes a local directory/inspector refinement, not the entire expense domain, audit or release. Expense revision comparison/history refinement, many-record/file/task variants, failed/denied/stale states, full native-format document-worker acceptance, exact-source hosted checks, preserved populated upgrade, installed capture and physical iPhone remain in scope.

The preceding public817ec449 finished all19 prerequisite groups and both ancillary workflows. Foundation job134546736434 failed its unchanged dependency audit on picomatch/GHSA-fc5q-39xc-vjpf (11 high-severity dependency-chain findings); the screenshot artifact absence follows the skipped build. The advisory still reports no patched version at the November17 check: https://github.com/advisories/GHSA-fc5q-39xc-vjpf . No audit exclusion, acceptance threshold or release gate was changed. Installed schema109 remains unchanged.
