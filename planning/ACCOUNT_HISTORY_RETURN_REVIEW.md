# Account-history selection and focus return

Original S13 requires safe selected-record/filter preservation and focus return. Accounting history previously lived only in the private mounted workspace. Clearing that workspace forgot the selected account and reset archived inclusion, so an archived account's history could disappear from the default list after return. Closing history also discarded the focused control.

Accounting navigation now retains an opaque validated `accountHistory` UUID and the finite `accountsArchived=show` filter alongside the existing section/report dates. Account names, revisions, reasons, editable payloads, credentials and original save references remain excluded. Invalid/duplicate selections are rejected. Opening history selects the Accounts section, so a future report-capable context still returns to the right workspace.

Privacy clearing removes all loaded account/history/editor data. After a fresh authorized directory load, an explicit Reopen action retrieves the selected history through the existing scoped reader; return and reload never automatically retrieve it. This also works for a selected account outside the current directory page. In that case the heading says Selected account history rather than pretending an early historical version is the current account name. Each history page keeps its actual names, versions, recorded evidence and existing CSV behavior. The archived filter is applied only to the directory reader.

History loading has explicit feedback. Connection failure retains the selection for a deliberate retry. Definite account-reader access denial now reuses the parent's complete private-clear path, including transient originals, while preserving only the existing opaque interrupted-save store and safe navigation. Closing history clears its pointer and returns focus to the matching directory action, or the Accounts heading if that row is not mounted. Explicitly clearing a restored selection also focuses the heading.

No account save/lookup/retirement command, accounting rule, SQL, migration, grant, export format, provider activation or business-data setup changes. This is existing-workflow navigation and state design, not a new financial capability.

The complete original account-settings browser tests retain account creation, immutable archival, actual committed/lost-response recovery, CSV/recording evidence, absent-original retirement and later settings flows. A supplementary helper adds privacy clearing/recheck, reload, archived filter, no automatic history request, genuine paused-reader loading, transport failure/explicit retry, focus return, actual missing-cookie denial, safe sign-in criteria and conserved account-version/audit rows. Fixture credentials and cookies remain in memory. All original parent deadlines and authentication/permission guards remain. Execution must be recorded against the actual tested source; registered assertions alone are not acceptance.

S13, S06, matching release/installed/owner review and physical iPhone acceptance remain subject to their full original scope.

## Executed evidence

The complete original account-settings journeys pass **2/2 on local `4c9b90b`** in `.local/design-account-history-return`, with fixed-source and owned-database cleanup proof. This includes the supplementary ready/reloaded, real paused-reader loading, transport-failure/explicit retry, reopened, close/focus, actual access-denied and safe-return checks in Chromium and WebKit. Account versions and business audit rows are unchanged by the inspections; original creation/archival/committed-original/absent-original retirement, recording evidence, CSV and later settings assertions still pass. Sixteen new history-return views cover 360/390/1440px ready/reopened states and 390/1440px denied states. The capture manifest records exact retained artifacts and hashes. These viewport checks do not establish physical iPhone or browser zoom acceptance.

The production build including TypeScript/server bundle, full lint and 56 focused navigation/sign-in checks passed before this native execution. Matching public release and installed/owner/device acceptance remain separate.
