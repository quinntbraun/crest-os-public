# Current implementation plan

## Active change: retained-object recovery

PR65/protected main393206cce63e83fcf0c1951b15f31c6951d1bc96, treee22b47fde40992a52dfce6c206793c5f4f8d4589, passed candidate40145236144 and actual-main40146988314. Exact-source proof is in PR65. Read WORKING_STATE.md and PHASE_3_OBJECT_RECOVERY.md; canonical ROADMAP/TESTING/SECURITY/DATABASE remain authoritative.

Extend the encrypted database drill with snapshot-bound retained originals, previews and quarantine. Use standard age and immutable vault candidates; independently verify ciphertext/destination, preflight every object and fail before SQL on missing files. Exercise emergency-key/fresh-process recovery and faults. Actual DB inventory stays explicitly drill-only until genuine domain tables exist. No fake parent, generic cabinet, schema/canonical change, production authority or cloud setup.

Keep all checks. Local Windows executes native age/object tests; PostgreSQL/Docker/Auth/build/browser proof comes from Linux CI. Record candidate and actual-main results in the feature PR. No automatic deletion/retry of uncertain candidates, unsupported complete-backup claim or status-only PR.

## Next

Complete finite Phase3 durable typed attachment publication/fresh-authorized reads, file inventory/basic manifest and compatible independent recovery, then Phase4's customer/vehicle/address/ownership workflow and common-format retrieval. Real typed parent FKs are mandatory; do not invent a generic cabinet. Bundle coherent workflow changes; preserve all real-data, phone/provider, accounting and V1 Calendar gates. No speculative verifier refinement or paid setup.
