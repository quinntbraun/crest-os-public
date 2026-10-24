# Security export source coverage

2026-10-24. Starts from protected PR48/main8983a7e172bbfa0a367b39a899c4ffc85112f055, treec29670004233b953b2d96862aa5ea81c5bbacf24. Complete candidate CI40062068986 and actual-main CI40063130586 passed1325 unit/39 files,602 DB/Auth including109 genuine Auth,9 pgTAP,16 shell/18 HTTPS leaf scenarios. This slice adds an executable inventory gate; it does not add source readers or change export authorization.

## Decision and coverage

EXPORTS_AND_BACKUPS section3 requires implemented business tables, stable identity/security metadata, history and configuration, with deliberate credential exclusions. SECURITY_EXPORT_COVERAGE.json accounts for every column of all22 source tables in crest and crest_private at schema27:255 required portable columns and10 explicitly excluded columns. This is an implementation checklist, not the future wire schema, an authorization scope or a completed export. CSV/XLSX codecs, dictionaries, safe bulk access and actual row collection remain unimplemented for these complete source rows.

The nine existing evidence groups are marked partial even when their canonical evidence contains many source values. A payload or immutable identity projection is not proof that all separate row metadata is recoverable. No column is considered fully exported by this gate. In particular, complete app-session metadata, actors, businesses, memberships, recovery authority, capability configuration, identity events, operations and audit rows remain outstanding. Identity events can be global or business-scoped; the mixed_identity inventory label explicitly does not decide tenant closure or grant access. Scope labels are descriptive only.

Exclusions are an exact reviewed table/column list in both the inventory and checker, not a name pattern or a general permission to omit records:

| Source | Excluded columns | Reason |
|---|---|---|
| app_sessions | token_hash, provider_token_ciphertext, key_id | Session credential material and its encryption key reference |
| login_limit_state | key_fingerprint | Runtime throttle-key fingerprint |
| login_attempts | identifier_hash, ip_hash | Private login/network correlation digests |
| login_contexts | credential_hash, csrf_hash | Browser credential digests |
| login_contexts | ip_hash | Private network correlation digest |
| session_csrf_tokens | token_hash | Browser credential digest |

All other columns, including safe runtime timestamps/IDs, identity epochs, original event payload/hash, operation results and audit hash_input, remain required. These contain private business/security information and require authenticated, encrypted/private custody. A safe field does not mean a public field. Future exclusion changes require explicit review in code and documentation; moving a reviewed credential into required output or hiding history behind a recognized exclusion label fails.

## Executed gate and limits

verifyExportCoverage is dependency-free metadata validation in tooling, outside runtime composition. It checks exact fields/version/applied migration count, unique tables/columns, supported descriptive scopes, exact exclusion reasons, known partial-reader/table associations and equality with observed columns. It returns a frozen schema_inventory_only summary with completePortableExport=false and completeBackup=false. It reads no environment, credentials, source rows or external service and cannot authorize an export/restore or mark a manifest Ready.

The existing actual PostgreSQL provider-reference suite obtains source names directly from pg_catalog, without information_schema privilege filtering or parsing SQL text. It compares all regular/partitioned tables in both Crest source schemas and all non-dropped user columns. Separate transactional fixtures add a real table and column and demonstrate rejection, then roll back and verify the original source inventory. Unit tests cover malformed input, missing/new/duplicate sources, migration mismatch, credential promotion, arbitrary exclusions and false completion claims. The synthetic unit catalog only exercises validator behavior; the database fixture is the actual coverage oracle.

This check validates declared column coverage, not column types, constraints, RLS policy correctness, migration authenticity, row contents/counts, cross-record closure, secret-free nested payloads, complete extraction, snapshot provenance, ciphertext custody or restore correctness. Existing migration checksums/compatibility and relevant database/security tests remain independent requirements. No custom SQL parser is used as a release oracle.

The manifest covers only Crest source schemas. supabase_migrations history, provider-owned auth schema, roles/functions/configuration, images and objects need separate compatible independent-backup evidence; none is silently reclassified as portable data or removed from backup obligations. Excluding active credentials from portable downloads does not authorize omitting them from an independently encrypted recovery point or restoring them as valid sessions. Backup secret/configuration custody and safe session invalidation/relink remain gated under the canonical recovery protocol.

## Next bounded implementation

Implement actual consistent safe identity/business/configuration source readers and original identity/operation/audit history extraction with an explicit business/actor reference-closure contract. Keep runtime credentials excluded and preserve original hashes versus newly projected metadata. Require a deliberate tenant boundary before granting any bulk SELECT or widening the inventory role; this checklist grants no privileges. Then compose complete coverage with the retained provider evidence within one owner-authorized snapshot, encrypted private output custody and independent restore tests. Broader maintenance/reconciliation gates and Phase3 files/recovery still precede CRM/catalog, scheduling and Calendar activation.

No SQL/migration, canonical amendment, package/lockfile, CI workflow, role/grant, credential setup, production apply/deployment/activation, signup/spending or real data changes. App0.1.0/schema0..27/report0/command1 and enabled-auth minimum22 are unchanged. Full candidate and protected actual-main CI remain required; local Docker is unavailable and Windows native Next compilation remains blocked by AppControl.
