# Bounded owner export history

2026-10-27. Extends the inactive owner controls with database-backed history, so reopening the screen can recover recorded jobs without browser IDs. There is still no product page, route registration, worker scheduling, download activation or canonical schema43 adoption.

## Live history boundary

The seventh unregistered supplement, `source-export-owner-reads.sql`, adds only `list_source_exports`. It reuses the closed owner/export.bulk/recent-session authorizer and exact22-column job projection. Preflight pins both source-body SHA-256 values, owner/language/volatility/definer/search-path/row-security configuration, closed roles, forced RLS and absent owner CREATE privilege. The new command-owned definer is callable only through the existing web principal; no raw table or internal export-role access is added. Registered42 routines and grants stay unchanged.

Each page independently authorizes the current business/owner/provider/session and rechecks authority after its source query. It returns at most five jobs ordered by immutable `(created_at,id)` descending. A supplied cursor must match an actual row and exact timestamp in the same business. The query reads at most six rows; the sixth indicates another page and is omitted from output. The returned next cursor is exactly the fifth returned row. Cursor columns never serve as authority. Pause permits read-only history; revoked or stale authority is rejected.

This is a live view, not a multi-page snapshot or complete export. Newer jobs committed after the first page appear on an explicit refresh rather than being inserted into older pages. Job updates can be observed on later reads; source export capture itself retains its separate owned snapshot protocol. Five rows keep the complete response inside the unchanged16KiB/128-node transport bounds. No record, byte, crypto or recovery cap increases.

The pure contract rejects extra fields, malformed or partial cursors, timestamp aliases, noncanonical UTC microseconds, wrong business/profile, sparse/accessor arrays, duplicates, wrong order, repeated/forward rows, oversized pages and inconsistent next cursors. It copies frozen typed rows and cursor. Owner access parses the cursor before asynchronous verification, uses a scoped fixed SQL statement and exposes only its private validated result. HTTP uses the existing trust/CSRF/admission/private-response guards; the browser uses the existing strict bounded transport.

## Owner controls

Explicit screen load reads the newest page after fresh context and pending-reference checks. An interrupted request takes precedence and does not trigger history lookup. Older-page navigation reacquires context, checks for newly saved pending work and replaces the bounded page rather than accumulating data. A returned-tab cancellation or principal change hides the history and prevents a late page from replacing a newer view. Only a job on the loaded page can be selected; selection itself performs no network action or mutation. Current status remains a separate authenticated read. A historical page, selected job or cursor grants no download authority.

The screen labels history and UTC timestamps, exposes explicit older-page and reload controls, and keeps the existing request/closing safeguards. History is server-backed; browser persistence still contains only a complete opaque pending original, with no proof, reason, source rows or history cache. Listing now replaces the previous controller's memory-only discovery limitation. Verified download and actual browser composition remain unfinished.

## Recovery and validation

Encrypted synthetic recovery now binds all seven exact ordered proposal paths and their current hashes, retaining the independent restored rows/schema/grants, incident fence and original retired-decision assertions. There are still six journal tables and114 source columns. Earlier six-file points require their matching older source; they are not relabelled. Legacy helpers and8MiB/64MiB inventory limits are unchanged.

All5,636 local units across165 files pass, including30 new history cases:14 pure contract,4 adapter,2 HTTP,3 browser transport,6 controller and1 static-render case. Types, focused lint and all changed native helper/test syntax pass. Initial history-fixture failures correctly exposed mismatched fixture root/row scope and widened literal types; fixture construction now preserves those bindings, with all assertions retained.

Five new PostgreSQL cases and two genuine Auth/actual-socket history cases are written, not locally executed. They cover source-drift/grant refusal, empty/read-only state, actual seven-job pagination and later-head exclusion, cursor/business/stale authority, pause/revocation, reopened history and foreign-provider authority. Combined with the prior controls context case, fresh expected native total is1,230 =679 foundation +423 provider +128 Auth, including236 proposal cases. The seven-file encrypted recovery path also requires fresh execution.

Prerequisite9eccce49/run40460827085 independently passed FULL1,222, including all three genuine HTTP cases, unit/build/browser/container/security checks and exact artifacts. The saved local controls checkpoint and this history checkpoint must publish their final tree together while retaining both recoverable bundles. That prerequisite does not accept these newer sources. No real-data readiness or complete export/backup claim.
