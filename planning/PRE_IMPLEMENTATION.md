# Current implementation plan

## Active change: customer directory backend

PR66/protected main8dc8d16ef9868490197db412b88a46d6b8f9b3ff, tree7c5daeb05ae0063ec1d69be7c8ebc27d44ba604e, passed candidate40150463624 and actual-main40152710258. Exact-source proof and finalized artifact bindings are in PR66. Retained object/database snapshot restoration is verified on isolated fixtures; independent cloud/vault/configuration/key/image recovery remains gated.

Read WORKING_STATE.md and PHASE_4_CUSTOMER_DIRECTORY.md. ADR41/ROADMAP1.6 explicitly overlap synthetic Phases3/4 construction so genuine CRM parents support later typed attachment links. This is sequencing within approved V1 scope, with all acceptance/security/export/recovery/accounting/real-data gates retained. Keep the existing stack and all checks.

Migration32 and the typed server adapter add customer create/edit/archive/reopen, scoped literal search/history, atomic operation/audit receipts and optimistic conflicts. Strict CSV formatting and same-snapshot readers retain all source columns; actual restore fixtures include customer history. No browser route, form, live setup or application activation is included. Verify native PG/upgrade/concurrency/recovery in Linux CI before calling this backend verified. No published SQL is edited; three current canonical amendments preserve immutable originals.

## Next

Implement customer HTTP/mobile forms with the existing fresh session, Origin/CSRF/admission boundaries and explicit trusted business configuration. Preserve stable pending operation/payload/epoch and status-before-identical-manual-retry after unknown outcomes. Then genuine vehicle/address relationships and durable typed attachment publication/authorized reads. Complete whole exports, compatible independent recovery, vault/heartbeat and incident authority before real-data approval. No speculative verifier refinement, paid setup or status-only PR.
