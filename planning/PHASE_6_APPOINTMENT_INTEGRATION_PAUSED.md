# Appointment integration checkpoint

This isolated integration is based on published quote source `31c582d5ade8d42bc5e4870788aba62bd4473249` (registered45), and incorporates appointment proposal source `4e0acf4689518dbc8afab484e90ca8c558b167c8` plus saved-history export `ce11acbaf22616d5438a8e06c93dff9b8d5a7ec0`.

It adds a test-only trusted server flag, workspace navigation, and the existing original-save review flow for the exact appointment reference. An absent request can be explicitly retired with a retained reason; a committed original must instead use its typed receipt. The new unregistered resolution SQL pins the predecessor validator body before adding the appointment kind. The source RPC uses the existing export credential in one read-only repeatable-read transaction; its coverage fragment is not a claim of global export coverage.

The focused actual Next browser journey creates a customer, saves a quote draft, saves/reloads an explicitly unconfirmed appointment proposal, then closes an interrupted unsent proposal through the existing review controls. This does not confirm a job or claim commercial acceptance.

## Coordination and activation

PR104 source `46727712979183ee170037d0d54a121a346caab9` now reserves registered46 for quote review/approval. This branch claims **no ordinal**. Before adoption, reconcile its validator and shared TypeScript additions with PR104, and obtain the quote owner's allocation for 47+ and shared registry/routing/coverage edits. The pinned predecessor intentionally refuses a changed validator instead of overwriting it. No registered SQL, registry, compatibility version or global coverage manifest was changed here. Runtime defaults and production activation remain closed.

Shared patch paths prepared only in this isolated branch: `src/server/node-server.ts`, `src/security/original-operation-reference.ts`, `src/client/pending-original-operation.ts`, `src/app/save-review/{page,review}.tsx`, `src/app/workspace-frame.tsx`, `tests/support/{migration-sandbox.mjs,original-operation-fixture.ts}`, `tests/unit/{original-operation-reference,pending-original-operation}.test.ts`, and the frozen registered44 corpus filter in `tests/integration/quote-draft-resolution.test.mjs`. No shared active owner branch was edited. Finance and expense sources are untouched.

Local build, TypeScript, focused 260 unit checks and canonical/migration verification passed. Native SQL and actual browser checks for this integration are not yet established; the focused workflow runs them on the public isolated branch. Earlier PR102 full CI run40788819775 passed all four jobs at source4e0acf4; the separate saved-history export focused run40791548288 passed at ce11acb. Those earlier results do not certify these new integration changes.
