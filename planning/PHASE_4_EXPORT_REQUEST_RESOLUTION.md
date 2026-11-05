# Proposed export-request resolution

Construction decision, 2026-10-27: add separate schema 43 export-request
resolution entry points. Preserve every registered schema 42 routine, client
allowlist and business/CRM retirement behavior. Reuse the audited operation-key
locking protocol already required by ADR42, with an explicit complete export
request reference and reason. This is an unregistered proposal; canonical adoption,
native verification and owner controls remain gated.

A retirement may claim only the original request's existing operation key. It
must serialize with an in-flight original writer. If the writer wins, resolution
reports original-recorded and requires typed original-request lookup; it never
cancels the job, deletes history or invents an original receipt. If explicit
retirement wins, its immutable audited decision prevents a later original request
from committing under that key. An absent observation alone never clears pending
state. A current recovery decision retains the complete original reference,
including its older epoch and release.

`source-export-request-resolution.sql` is a sixth unregistered supplement. Its
preflight pins the source bodies, owners, language, volatility and safe settings
of six reused registered helpers, checks closed roles/forced RLS and refuses
unexpected command-owner CREATE authority. Its two new definers retain the
registered retirement and lookup protocol bodies, changing only entry-point
names and the closed export-request validator. No existing routine or grant is
replaced. The validator accepts only the complete schema 43 joint request and
rejects other command families, extra fields and ambiguous source-version text.

The pure `source-export-request-resolution.ts` contract preserves the original
request's epoch/release separately from the current retirement decision. Absent,
conflict and original-recorded outcomes remain distinct from retired. A retired
result retains exact reason, current decision epoch and immutable audit identity;
mutation acknowledgments must match the submitted reason/epoch. The private owner
adapter adds `retireRequest` and `lookupResolution`, using fresh recent provider
authentication, confirmed COMMIT and explicit stop-on-unknown behavior. None of
these outcomes is a download capability or an original export receipt.

All 5,437 local unit cases across 157 files pass, including 31 pure resolution
cases and 51 owner-access cases. Types, focused lint and native JavaScript syntax
pass. Every registered migration and schema 42 resolution interface is unchanged.
The worker/storage/session sources remain unchanged from the independently
accepted 4ab5d0bc release: all 1,198 database/Auth cases and complete build,
browser, container and source-bound artifact checks passed for that prerequisite.
That proof cannot accept this new supplement.

Seventeen new PostgreSQL cases are written for preflight/source preservation,
audited retirement, original-writer wins, immutable replay fields, all four real
commit/rollback races, audit-failure rollback, closed grants/legacy refusal,
malformed inputs, old-epoch decisions, pause and absence/scope. Two new genuine
Auth cases cover retained old references/current decisions, fresh replay/lookup,
pause, original-recorded distinction and provider revocation. Together with the
two earlier owner-access cases, expected totals are 231 proposal cases, 122 Auth
and 1,219 database/Auth cases. Fresh Linux execution is required.

The existing encrypted recovery drill now seeds an actual export-retirement
decision before its exported snapshot and looks up that exact immutable decision
under fresh paused authority after restoration. Its bounded proposal binding
fingerprints all six supplements. Older five-file proposal points require their
matching older source; no fingerprint or backup is silently relabeled. Legacy
registered recovery helpers and all byte/row/crypto limits remain unchanged.

Next: native findings, explicit canonical schema 43 adoption and owner pending,
request/status and bounded download controls. No runtime route, new table,
production activation, financial action or complete-backup claim.
