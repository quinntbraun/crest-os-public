# Service catalog server adapter

2026-10-27. Construction over registered43 and the unregistered catalog schema/commands. No application route, runtime activation, migration adoption or permanent editor save is enabled.

## Implemented boundary

`src/commercial/service-directory.ts` connects the existing private database executor and genuine session lifecycle to the four fixed catalog SQL commands. It verifies current provider/session evidence in background mode, seals the complete request and nested definition before asynchronous work, passes only typed parameters, and clears its credential digest buffer afterward. It adds no capability, runtime flag, provider or dependency. The existing owner `crm.manage` mapping remains nonfinancial service preparation.

Save evidence is released only after `sessionDatabase.commandTransaction` acknowledges a real COMMIT. Failures before the save query are reported as not submitted. Malformed returned receipts, interrupted submissions, SQL failures and missing COMMIT acknowledgment remain unknown outcomes. There is no automatic retry or replacement operation. A separate fresh-authorized lookup retrieves the original operation result. Denial, stale/code/operation conflicts, unchanged state and the fixed recovery-review marker remain distinct; raw provider/SQL errors never cross the boundary.

The data-only `service-storage-contract.ts` parses exact service/content projections, root revision and content sequence strings, retained receipts and scoped directory/history pages. It validates tenant and parent identity, current pointer, inactive selection, UUID order, page bounds, contiguous root history, retained immutable provenance, event actor/operation, edit/active-state transitions, repeated retained content and final header agreement. Bigint cents, durations, revisions and six-digit UTC timestamps remain exact. Internal guidance remains private owner data; customer quote documents must continue using the separate customer-only snapshot contract.

Private results reject accidental JSON serialization and expose immutable data only through an explicit server accessor. This adapter is absent from the running review bundle and is not an HTTP authentication boundary by itself.

## Verification

The preceding command source public4a0da8d6/localef53f885/treebda786e8, candidate36477f5d, run40600379757 passed all1,635 native cases:1,071 database foundation (including55 catalog commands and29 schema cases),423 provider/evidence and141 genuine authentication cases. That exact source's full release checks are tracked separately. Its earlier17/55 and54/55 command attempts remain failed and retained; no regression or completion constraint was removed.

Local tests for this adapter pass81 focused cases, including delayed/missing commit acknowledgment, private results, exact large integers, malformed/mismatched data, request mutation during verification, cancellation, hash clearing, filtered/ordered pages and broken history. The full local suite passes6,139 cases across188 files, with types and full lint. The initial corrupt-content test shared the same fixture object across two revisions; it now replaces only the archive event's content so that it actually tests divergence. The parser rejected that divergent record without a code change.

Nine additional genuine Auth/MFA/PostgreSQL adapter cases are written in `tests/integration/service-catalog-auth.test.mjs`. They apply the unchanged hashed proposals only in a disposable registered43 database, use the restricted backend login and real provider service, and cover save/edit/archive/reopen/original lookup, pagination, no-op/conflict activity, foreign owners, revoke/provider loss/AAL downgrade, recovery pause/epoch, actual deferred COMMIT rejection, actual audit rollback and a genuine customer-operation collision. They are mandatory in the existing genuine-Auth group via `test:real-auth`, with a separate `test:catalog-auth` command for focused diagnosis. Their native acceptance is pending this new exact source. Unit mocks test the adapter's orchestration only and do not substitute for this execution.

All28 isolated HTTP review tests pass, leaving the served JavaScript and saved fictional CRM records/history unchanged. Existing page-only service/quote drafts remain temporary; this change adds no visible feature or simulated persistence.

## Remaining gates

Inspect the new genuine adapter results and repair any failure while retaining its regression. Then implement complete catalog source CSV/inventory and independent restore acceptance. The registered original-operation resolution contract currently enumerates existing CRM commands and excludes `catalog.service.save`; typed catalog interrupted-save review/retirement must be added and tested before exposing permanent saves. Preserve original operation/epoch semantics rather than silently minting a replacement after an uncertain result.

Migration adoption, compatible source-export/recovery composition, the private HTTP/form connection and a configured durable synthetic runtime remain required. Real Crest data, financial posting and production activation stay gated. There is no new dependency, paid service, signup or host installation. Cost$0. V1 remains roughly25-35% coded; the broad low-confidence estimates remain15-30 active hours for durable synthetic CRM testing after runtime prerequisites and200-350 for full V1.
