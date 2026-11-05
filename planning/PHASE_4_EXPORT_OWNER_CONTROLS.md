# Owner export controls and current context

2026-10-27. Extends the per-tab pending store and gated HTTP transport. The screen component is implemented but has no product page, navigation entry, runtime registration or activation. Job listing, verified download and explicit canonical schema43 adoption remain required before enabling it.

## Context and authority

The private owner access boundary adds a context read with fresh recent provider/local verification and the existing registered `read_business_settings_context` routine. The response contains only the verified actor, fixed business, fixed server release, closed schema43/profile and current write state/epoch. Pause returns a null epoch. It omits legal name, business version, credentials and session identifiers. This is review metadata; each actual export operation still separately enforces current SQL owner/export capability and session/recovery authority. The context is not an export permission, lease or download capability.

HTTP gains an empty-body `context` action behind the same trusted socket/host/origin/fetch-site, cookie/CSRF, bounded UTF-8 body and committed admission gates. Enabled composition now requires a fixed valid server release. New requests for a different release fail before dispatch; original receipt and resolution lookups retain the entire historical reference without rebasing it. Registered server routes, SQL, migration registry, worker, storage, capture/verifier and dependencies are unchanged.

## Controller and screen behavior

Every action reacquires a session proof and current context. The proof is copied before the context await and expiry/cancellation checked afterwards. Scope must still match the loaded actor/business; a change blocks the action and hides prior details. An explicit reload can open the newly verified principal's own namespace without moving or erasing the previous reference. Returning to the tab aborts ongoing work, hides references/reason/job details and requires review. Disposal and late responses cannot clear storage or overwrite a newer view.

A new request creates its two IDs only after fresh scope, write-state and pending checks. It persists and rereads the whole original before one dispatch. Double clicks, concurrent actions, unconfirmed storage writes, a newly discovered pending entry, pause and expired proof prevent dispatch. Network uncertainty and confirmed conflicts retain the original; there is no retry action or automatic lookup, polling, replacement or epoch/release rebasing.

Explicit original lookup releases pending only with a complete matching committed request receipt. Closing requires an entered reason and a freshly read current decision epoch; a retired acknowledgement must match both as well as the entire original. Uncertain closing can be resolved through an explicit historical decision lookup. Absent/conflict/original-recorded observations retain pending; original-recorded does not silently trigger another read. A changed storage pointer or failed removal blocks completion. Current job status is a separate explicit read; a historical Queued receipt never supplies it. The selected job is currently held only in controller memory; durable job listing remains an activation prerequisite.

The screen has labelled actions, a keyboard-focusable live status, a bounded reason field/counter, private-file guidance and explicit explanation that closing an interrupted request does not cancel an already recorded export. Reasons remain in memory until submitted; no reason, proof, credential or source data enters browser persistence. The original opaque reference is the only stored body. Existing mobile styles are reused with a scoped textarea style. No browser/accessibility conformance is claimed from static rendering alone.

## Validation and next step

All5,606 local units across164 files pass:29 controller,10 pure context,8 added owner-adapter,4 added HTTP/client context and3 static-render cases extend the previous5,552 baseline. Type checking, focused lint and native test syntax pass. An initial failure exposed leftover one-shot mock responses in the owner-adapter suite; resetting each test's mocks fixes isolation without changing application behavior or removing assertions.

One new genuine Auth/PostgreSQL/actual-socket context case is written and syntax checked, not locally executed: exact current actor/business/server release, rejected caller-selected actor before provider work, pause/null epoch, provider revocation and unchanged private source facts. Expected next native total1,223 =674 foundation +423 provider +126 genuine Auth, retaining231 proposal cases. Existing three genuine HTTP cases remain and receive only the required fixed server release in their test composition.

Prerequisite published source9eccce49/run40460827085 independently passed all1,222 database/Auth cases including its three real-socket HTTP cases; full release remains separate. Source3694acf6/run40457210411 has complete FULL1,219 acceptance. Preserve the current full run before publishing this controls checkpoint, then require fresh exact-source native/full execution. Job listing, downloads, canonical adoption and real browser composition remain next. No real-data readiness or complete export/backup claim.
