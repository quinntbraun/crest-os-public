# Per-tab pending export request reference

Unregistered schema 43 construction, 2026-10-27. The private owner export flow
needs to retain its original request across reloads and uncertain responses.
`createPendingExportRequestStore` adds only that browser data boundary; it creates
no screen, route, network call, worker dispatch, automatic retry or download.

The caller supplies its currently verified business and actor. Each per-tab
storage namespace is scoped to both IDs. The stored body contains only version,
actor UUID and the complete closed original request reference: business, operation,
recovery epoch, job UUID, release, profile and source schema. No credentials,
retirement reason, draft, source rows, customer data or financial content is stored.
The exact canonical comparison string is a pointer binding, not authentication.
The caller still needs its current principal and authenticated transport before
using any result. No global CRM mutation fence is introduced by this store.

Record the complete reference and confirm it by rereading storage before dispatch.
The same original can be reopened without another write. A different original,
changed release, corrupt/noncanonical entry, inaccessible storage or unconfirmed
write blocks the action rather than replacing the reference. No identity, epoch
or release is generated or rebased here.

There is no generic clear method. Release requires either the fully matching
typed original committed request receipt for this actor, or a matching immutable
retired decision. Absent, conflict and original-recorded observations cannot clear
pending. A changed pointer or cancellation blocks release even with a valid older
response. Failed removal is reported as unresolved. Original request receipts
are historical; neither they nor retirement decisions grant current job, lease,
session or download authority.

All 5,464 local unit cases across 158 files pass, including 27 new pending-store
cases. Types and focused lint pass. Backend, SQL, storage and native-test sources
are unchanged from the corrected resolution source 3694acf6. That prerequisite's
run40457210411 independently passed all 1,219 database/Auth cases, including
encrypted restore of the exact retirement decision. Its full release remains
separate; new browser-store code needs its own release execution after publication.
No existing test timeout, assertion, migration or canonical rule changed.

Next: preserve the prerequisite full release, then compose fresh-proof owner
request/status/resolution controls and their HTTP transport, with explicit schema
43 adoption and bounded current-authority download before activation. No real-data
readiness, complete export or complete-backup claim.
