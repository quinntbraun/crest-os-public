# Current implementation plan

## Active change: fix synthetic recovery seed clock

PR59/main2d16abefbc8d49f2d20ab1b9204d03f400fa00b9 has green candidate proof but a failed main fixture setup. A materialized timestamp fixes the one-microsecond session-boundary race; do not weaken the constraint or retry unchanged source. The added native drift regression must reject the invalid interval and verify exact corrected boundaries. Read WORKING_STATE.md for exact baseline evidence and PHASE_3_RECOVERY_DRILL.md for scope and assurance limits. Historical plans are preserved in Git through PR58; execution notes never override canonical contracts.

Deliver one coherent native recovery proof using existing PostgreSQL17 tools and official checksum-pinned age1.3.2. Preserve a single exported snapshot, actual complete fixture DB/schema/grants/migration history, emergency-key decryptability and a fresh isolated-cluster restore. Test corrupt/missing/wrong-key inputs, refusal to overwrite existing definitions, exact source values and unchanged source, restored authorization/immutability, and explicit drill-only epoch/session invalidation before reviewed new commands.

Run all16 native recovery scenarios to mandatory foundation CI without removing any existing command or weakening the required aggregate. Run local available lint/types/unit/provenance/audit/secret checks; actual PG/Auth/native build/browser/container proof is Linux CI. Complete candidate verification, normal protected merge and exact actual-main verification, with source/run/job/artifact bindings in the PR. Do not chase stale auxiliary step arrays after terminal trusted checks plus complete mandatory command/finalized-artifact logs establish success; disclose metadata limitations.

No schema migration or canonical amendment is needed: production functions/grants remain unchanged. The synthetic incident fixture is not a production recovery command or proof that former production writers were fenced. Archive size/memory/capacity bounds are explicit test limits. No real data, paid service, provisioning, deployment or production authority is enabled.

## After this change

Continue Phase3 private originals, compatible configuration/key/image recovery, independent vault/retention/heartbeat and incident authority/fencing with finite acceptance. Then Phase4's first customer/vehicle workflow, exports included per domain. Follow ROADMAP/TESTING and USABLE_RELEASE_MILESTONES.md; retain original V1, all safety/release requirements and Calendar prerequisites. Bundle related logic/UI/schema/exports/regressions into reviewable feature-sized changes. Actual restore and product workflows take priority over speculative verifier refinements.
