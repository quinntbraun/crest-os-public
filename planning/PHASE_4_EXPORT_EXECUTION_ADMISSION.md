# Export execution admission construction

2026-10-27. Unpublished dependency closure based on integrated app source18eeeff5c38d513b90ff0de1f6bc21e6b8a624a4, whose native1,507 cases are independently accepted and whose full product/browser release is separate. The current executable cannot yet generate a newly queued export. This construction does not enable it.

## Concrete safety gap and selected mechanism

The existing request RPC returns the same committed original receipt for a newly inserted request and a replay. Scheduling a file-writing worker whenever that receipt appears could start duplicate attempts after a repeated POST, lost acknowledgement or process restart. An earlier absent lookup, guessed timestamp/transaction ID or process-local mutex does not prove that this call created the durable request.

Add a fixed database request entry point that reports created versus recorded from the original operation-key INSERT itself. It retains the exact schema43 request digest, original request receipt, one-active-job constraint, immutable operation/audit, owner/MFA/provider/recovery checks and foreground activity semantics. The source projection/profile stays43 even when the operational database later gains migration44. There are no new tables or source columns.

The SQL construction in planning/proposals/source-export-execution-admission.sql pins seven existing function bodies/owners/configuration, including the directly used recovery authority gate, plus closed roles/default privileges and forced RLS. Actor/business/session-update prelocking precedes recovery and the original operation key; no lock spans provider, capture or storage I/O. Recheck authority after waiting. A duplicate returns recorded and the original receipt; conflicting/duplicate business identity rolls the new operation back. Keep verified transaction scope through deferred audit at COMMIT. Existing43 SQL and RPC implementations remain unchanged.

The trusted TypeScript bridge validates the exact original/business/release before provider I/O, uses fresh real session verification, and parses the SQL result inside commandTransaction. Only a resolved COMMIT followed by a non-aborted request mints an in-process one-use scheduling observation. A malformed response, unknown COMMIT outcome, changed actor or late abort never does. Buffers owned for the credential hash are cleared; no credential is stored in the observation. It cannot be JSON serialized, copied or reconstructed from a receipt, lookup or replay. Consume it before scheduling; an aborted consumption also destroys it. This observation is not current authentication, a lease, storage permission or proof that a worker ran.

## Remaining coherent execution work

Before use, adopt the technical decision/canonical documentation and register append-only migration44, preserving every existing43 checksum. Update operational compatibility/inventory counts honestly; content/source projection remains43 and source fields remain39tables/603required/10credential exclusions. Preserve historical42 and43 recovery identities; do not relabel a44 dump as43.

Require actual PostgreSQL source-drift/ACL/RLS/rollback and mixed legacy/new-RPC concurrency tests: same original in one transaction and independent devices, commit/rollback winner orderings, one-active-job conflicts, altered originals, audit/activity failures, provider/session/recovery loss across waits and unchanged old receipts. Then prove real Auth bridge composition and independently keyed44 restore with revoked/rotated authority. Local mocked COMMIT tests do not establish database semantics.

Only after that acceptance, compose a bounded owner-initiated in-process task from the fresh observation. It must generate one existing claim/Ready operation set, reacquire fresh credentials at every stage, use the already tested collector/journal/private-store worker, and abort on shutdown/revocation/failure. Never persist a browser credential or automatically restart/replay an uncertain object write. Recorded requests and historical status never schedule work. A request left Queued/Running after process loss needs honest status and explicit owner stop/new-request recovery, retaining all prior evidence. Worker/task-manager, private HTTP integration and operator controls remain unimplemented in this slice; protect their finite scope.

Require actual Next request-to-Ready-to-save acceptance before claiming usable generation. Default startup/production activation, completePortableExport/completeBackup, physical-device and independent operating recovery gates remain unchanged. No paid queue/service, signup or owner action is required for this construction.

## Executed evidence

All5,953 units/180files pass, including41 new admission/bridge cases. Types, focused lint, native syntax/diff and direct pinned Node import under the normal server-only marker condition pass. Tests distinguish created/recorded/conflict, reject malformed/accessor/foreign receipts, check one-use/aborted/private observations, pre-I/O original copying, actor changes, credential-hash clearing, explicit recovery fence, rollback and lost/aborted COMMIT acknowledgement.

The SQL is construction only: migration44 is not registered or applied, no native SQL/concurrency/Auth/restore acceptance is claimed, and no route/task uses this bridge. Current registry remains43, canonical amendments12 and dependencies297. The integrated PR91 source/run retains its own exact-source proof; it does not accept these additions.

## Native acceptance construction

Two disposable suites apply the proposal over an explicit registered43 prefix without changing the migration ledger. The database suite defines38 cases: seven function drifts, three unsafe owner roles, five missing forced-RLS guards, default ACL refusal, closed installation with unchanged prior definitions, same-transaction created/recorded identity, ten mixed legacy/foreground/admission device winner and commit/rollback orderings, conflicting originals/releases/active jobs, audit/activity/deferred-COMMIT rollback, four authority losses while genuinely blocked, same-session serialization and stale-owner/raw-grant refusals. The genuine Auth suite defines six cases for post-COMMIT one-use scheduling, recorded replay, local/provider loss, paused/rotated recovery, actual audit rollback and explicit retry, another owner and conflict. Neither suite performs object writes or enables task dispatch.

Local syntax and focused ESLint pass; these44 cases have not yet executed against PostgreSQL/Auth. Existing5953 unit cases/180files remain the separate executed local result. Wire both suites into mandatory existing CI groups; expected fresh native total1551=987foundation+423provider+141Auth, with all existing1507 retained. Registry remains43. Native acceptance is required before44 adoption or execution activation.

Publish this reviewed proposal/bridge/test construction on its own draft branch, preserving PR91/public07470/run40528663344 while its corrected45-minute full release runs. No manual CI retry/cancel, artifact waiver or parent-proof substitution is permitted. The new draft must pass fresh exact-source native and full checks; a draft or local test construction is not an accepted release. Whole-source privacy/secret scan and recoverable source bundles are required before publication.
