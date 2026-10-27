# Private owner export request and status access

Unregistered schema 43 construction, 2026-10-27. This adds the server boundary
needed before the owner request/status screen. It creates no HTTP route,
scheduler, worker dispatch, download capability or production activation.

`createSourceExportOwnerAccess` fixes one business at construction and exposes
three initial private methods: `request`, `status` and `lookupRequest`. The later
[isolated export-resolution proposal](PHASE_4_EXPORT_REQUEST_RESOLUTION.md) adds
`retireRequest` and `lookupResolution` without widening schema 42 interfaces.
Every call uses
separate credentials and fresh recent provider/local authentication. The existing
fixed SQL routines still enforce current owner capability, business scope and
recovery authority. Caller-supplied actors and arbitrary SQL are never accepted.
Credential hash buffers are cleared after each call. Private results and the
access object refuse generic JSON serialization.

Request accepts only the complete closed `export.request` reference. Business,
operation, recovery epoch, job ID, profile, source schema and original release
are copied before asynchronous work. The adapter never substitutes current IDs,
epoch or release. These are typed command values, not an original raw HTTP body;
the existing SQL command contract owns their canonical immutable receipt.
The higher owner flow must create a new reference using the intended release
and retain that exact reference across uncertainty. A returned original Queued
receipt is historical; the separate status method reads current job metadata.

The request result is validated inside the transaction, and success is withheld
until confirmed COMMIT. Confirmed operation or active/identity conflicts remain
explicit. A response or commit that may have been lost returns an unknown-outcome
error without retry, replacement IDs, automatic worker claim or another request.
Only explicit `lookupRequest` reads the original operation and checks the complete
receipt against that original reference and the authenticated recording actor.
An absent lookup is point-in-time evidence, not proof that an in-flight request
failed. No pending-reference retirement rule or automatic conflict resolution is
introduced by this adapter.

Status checks the returned job's exact ID, fixed business and closed 22-column
contract. It grants no live lease or download authority. Both read methods can
return historical evidence during a write pause under the existing SQL read
policy; request mutation remains recovery-fenced. Revoked sessions and late
responses after cancellation release no successful request or private read.

Validation: all 5,394 local unit cases across 156 files pass, including 39 new
owner-access cases covering original-reference copying, commit uncertainty,
explicit lookup without retry, malformed/foreign receipts and job status,
separate credentials, cancellation and recovery fences. Types, focused lint and
native-test syntax pass. The worker/storage modules are unchanged from the
preceding 53-case actual SDK/HTTP acceptance.

Two new genuine Auth/PG cases are written: request creation and exact replay with
separate status/original lookup, including reads during a write pause with no
history changes; and provider-session loss refusing requests and private reads.
Expected totals are 120 genuine Auth and 1,200 database/authentication cases,
retaining all 214 proposal cases. Fresh execution is required. Prerequisite worker
source 4ab5d0bc/run40451488347 independently passed all 1,198 database/authentication
cases, including real encrypted joint delivery and fresh per-stage Auth; its
complete release remains separate and cannot accept this newer source.

The schema 42 original-operation reference contract remains closed to
`export.request`. The separate forward resolution proposal supplies the required
audited behavior; its native execution and canonical adoption must precede owner
clear-pending controls. Absence alone never permits start-over.

Next: inspect new native findings, complete explicit schema 43 adoption and the
owner's pending-reference/request/status controls, then current-authority bounded
download. No complete export/backup or real-data readiness claim.
