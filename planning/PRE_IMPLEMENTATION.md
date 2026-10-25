# Current implementation plan

## Active change: customer editor over the private HTTP/backend reviews

PR66/protected main8dc8d16ef9868490197db412b88a46d6b8f9b3ff, tree7c5daeb05ae0063ec1d69be7c8ebc27d44ba604e, passed candidate40150463624 and actual-main40152710258. Exact-source proof and finalized artifact bindings are in PR66. Retained object/database snapshot restoration is verified on isolated fixtures; independent cloud/vault/configuration/key/image recovery remains gated.

Read WORKING_STATE.md and PHASE_4_CUSTOMER_DIRECTORY.md. ADR41/ROADMAP1.6 explicitly overlap synthetic Phases3/4 construction so genuine CRM parents support later typed attachment links. This is sequencing within approved V1 scope, with all acceptance/security/export/recovery/accounting/real-data gates retained. Keep the existing stack and all checks.

PR67 adds the real customer backend with migrations32-33, scoped history, atomic receipts and strict encrypted restore coverage. PR68 adds the explicitly configured private HTTP routes and stateless browser transport. Verify their actual heads/candidate/main checks before merging or treating them as release proof. Every published SQL and canonical provenance byte remains unchanged by this consumer.

The customer editor adds search, optional raw/null/empty values, create/edit/archive/reopen and bounded history at `/customers`. Its controller stores only opaque pending references per tab, with contact data and retry payloads in memory. Explicit lookup precedes an identical manual retry under the original sign-in/epoch. Background/reload clears private drafts; absent/lost-draft intent remains review-blocked without replacement. This unresolved-intent operator workflow remains a real-use gate. See PHASE_4_CUSTOMER_EDITOR.md. Local unit/type/lint/server checks do not establish actual compiled HTTPS/browser acceptance.

## Next

Execute the editor's genuine HTTPS/Auth/PostgreSQL Chromium/WebKit flows and accessibility checks, resolving failures while preserving every existing gate. Merge verified backend, HTTP and editor reviews in dependency order, rechecking their actual candidates/main. Then genuine vehicle/address relationships and durable typed attachment publication/authorized reads. Complete unresolved-intent operator recovery, whole exports, compatible independent recovery, vault/heartbeat and incident authority before real-data approval. No speculative verifier refinement, paid setup or status-only PR.
