# Public canonical maintenance

Version: 1.2 | 2026-10-23 | Calendar amendment and ADR36 technical maintenance decision

PUBLICATION.md records the explicitly authorized fresh public baseline, privacy changes, version register and retained private provenance. The original private manifest is unchanged and is never represented as verifying these redacted bytes.

The public CANONICAL_MANIFEST.json is immutable once committed in the public baseline. CANONICAL_MAINTENANCE.json identifies that exact Git commit. scripts/verify-canonical.mjs checks the manifest byte-for-byte against that commit, checks all baseline document SHA-256 hashes/lengths from Git, and verifies current documents against baseline or explicit versioned amendments. The initial public baseline had no later amendments; the first explicit amendment is recorded below. Future amendments must identify original hashes/lengths plus changed version/hash/length and a reason in this file; never overwrite baseline provenance or silently regenerate its manifest.

No technical requirement or activation gate is relaxed. Source/test/lockfile/container identity comparison and public verification are in planning/PUBLICATION_EVIDENCE.md. Production activation remains blocked.

## 2026-10-22 - Owner-requested V1 Google Calendar capability

Reason/authority: the owner explicitly requested Google Calendar connection capability in V1, extensive investigation and the same rigorous tests/reliability as the rest of Crest. Previously PRODUCT made this optional, ARCHITECTURE excluded it and ROADMAP excluded automatic calendar sync; those exact conflicts are now resolved by P20/BR21/ADR35. Owner connection remains opt-in; outbound-only dedicated-calendar view, internal source of truth, least scope/minimal disclosure, free-first operation and all existing integrity/security/accounting/recovery gates remain. Research and planned GC01-GC18: planning/GOOGLE_CALENDAR_V1.md. This amendment implements no feature or production setting and spends nothing.

Changed versions: PRODUCT1.5, BUSINESS_RULES1.4, ARCHITECTURE1.6, ARCHITECTURE_DECISIONS1.6, DATABASE1.5, SECURITY1.5, EXPORTS_AND_BACKUPS1.5, ROADMAP1.5, TESTING1.5, CANONICAL_ADOPTION_REPORT1.4 and ARCHITECTURE_REVIEW1.5. PUBLICATION1.1 is the twelfth explicit amendment and carries the current register. ACCOUNTING1.5 and CREST_CONTEXT1.0 remain byte-identical, as do all16 SQL and the baseline manifest. CANONICAL_MAINTENANCE.json records each original manifest hash/length and explicit new version/hash/length/reason; none of the original provenance is regenerated. Verification checks baseline and amended bytes separately.

## 2026-10-23 - Explicit exact-target provider reduction decision

Reason/authority: owner continuation of the existing security/recovery work; ARCHITECTURE requires an ADR for a changed transaction/trust boundary. ADR36 explicitly selects the narrow, pinned, source-checked transactional provider adapter. It adds no business scope, provider/runtime switch, financial change, hosted grant, spending or production activation. Keep all Calendar and original accounting/security/recovery contracts. Ordinary app/worker/recovery/inventory callers receive no provider-write grant; actual operator permission/support and all production gates remain.

ARCHITECTURE_DECISIONS.md: prior amended SHA256 e194836811ef49e17401b7b4acc8a36ee8a248a01ca92ead272406968360b761, 19895 bytes; now version 1.7, SHA256 94d7905f5f9cb1cf58a6ffcf7b83afc09a3b94a7e7ae3990c3c9b98c960e8b27, 24898 bytes. Earlier amended bytes remain in PR37/main f399bdf8e5fb2b12e316b560eff7cf76195c999b.

PUBLICATION.md: prior amended SHA256 a04bf5e796ecd06e268c4c2e4eb260ae853a53a7521b5fcd67bbd129ef599343, 5793 bytes; now version 1.2, SHA256 ac1cca21ed30f9db54c13daa35dc60f3fd9acae437b55984338d3c677101e5d0, 5847 bytes. Earlier amended bytes remain in PR37/main f399bdf8e5fb2b12e316b560eff7cf76195c999b.

Original baseline manifest and every original hash/length stay immutable. The existing current amendment entries for these two documents advance to the new explicitly recorded versions while preserving their original baseline identities; ten other amended documents and all23 prior SQL remain byte-identical. Maintenance JSON keeps12 distinct amended documents, not a count of chronological change events.

## 2026-10-24 - Isolated business configuration export boundary

Owner continuation of existing export/recovery work; ADR37 records the separate nonlogin read-only business metadata boundary required by ARCHITECTURE. No business/financial scope or production permission changes. Keep provider inventory and ordinary runtime privileges unchanged. All 27 prior SQL and the original baseline manifest remain immutable; ten other amended documents retain identical bytes. The same 12 distinct current amendment entries remain, not 13.

ARCHITECTURE_DECISIONS.md: prior amended SHA256 94d7905f5f9cb1cf58a6ffcf7b83afc09a3b94a7e7ae3990c3c9b98c960e8b27, 24898 bytes at PR49/main fefc8e46bba37f3bc61cf3fc24c97b097c70a928; now version 1.8, SHA256 2d9d5b2807bf242c2e4d5e63aaadb28ed8522cfb592a5dcb197260af0b558ee0, 28165 bytes. Original baseline hash/length are unchanged.

PUBLICATION.md: prior amended SHA256 ac1cca21ed30f9db54c13daa35dc60f3fd9acae437b55984338d3c677101e5d0, 5847 bytes at PR49/main fefc8e46bba37f3bc61cf3fc24c97b097c70a928; now version 1.3, SHA256 027dda264f9aa61cc28f8d00a8c4bdcab8eecc08967776a9855dc7b60fc94f77, 5846 bytes. Original baseline hash/length are unchanged.

## 2026-10-24 - Original operation/audit evidence export boundary

Owner continuation of existing export/recovery work. ADR38 explicitly extends the isolated nonlogin export definer with safe business-scoped operation/audit SELECT only, preserving original hash evidence and declaring JSON-text precision/row/page limits. No ordinary runtime, provider/actor/session read, financial semantic or production permission expansion. All28 prior SQL, original baseline manifest and ten other amended documents remain immutable; the same12 distinct amendment entries are retained.

ARCHITECTURE_DECISIONS.md: prior amended SHA256 2d9d5b2807bf242c2e4d5e63aaadb28ed8522cfb592a5dcb197260af0b558ee0, 28165 bytes at PR50/main89c68de21fd5f4cd116e8bf7cf73768cc86ada3a; now version1.9, SHA256 ecf466766fa000a6f8a88e50f3e43015459c584bb75f2fbd11d388a72b5fefe5, 32018 bytes. Original baseline hash/length retained.

PUBLICATION.md: prior amended SHA256 027dda264f9aa61cc28f8d00a8c4bdcab8eecc08967776a9855dc7b60fc94f77, 5846 bytes at PR50/main89c68de21fd5f4cd116e8bf7cf73768cc86ada3a; now version1.4, SHA256 c8031ef7ab62de09a7f07c92d95624505dbced83a41bf5f88e99c0c5eb311fc8, 5851 bytes. Original baseline hash/length retained.

## 2026-10-24 - Identity ancestry and original identity-history export

Owner continuation of existing export/recovery work. ADR39 selects a new isolated read-only identity definer and exact business/actor-operator ancestry scope, with original history/current-row consistency and explicit processing bounds. Earlier export owners/grants/routines, all29 prior SQL and the original baseline manifest remain unchanged. No ordinary runtime/session/provider/credential authority, business/financial semantics, spending or production permission expansion. Same12 distinct current amendments; ten other amended documents retain identical bytes.

ARCHITECTURE_DECISIONS.md: prior amended SHA256 ecf466766fa000a6f8a88e50f3e43015459c584bb75f2fbd11d388a72b5fefe5, 32018 bytes at PR52/maind8c72572096279b0b35921fb3df3349152d9279e; now version1.10, SHA256 6cfa0adf14319e7e900fb7986a48ee76cf9b1479500df70e08e1be2e7b786622, 36739 bytes. Original baseline hash/length retained.

PUBLICATION.md: prior amended SHA256 c8031ef7ab62de09a7f07c92d95624505dbced83a41bf5f88e99c0c5eb311fc8, 5851 bytes at PR52/maind8c72572096279b0b35921fb3df3349152d9279e; now version1.5, SHA256 7a1ee8028deee681206a33a070fba12b938142ae44f3810e46967020179879b5, 5853 bytes. Original baseline hash/length retained.

## 2026-10-24 - Safe current session metadata export

Owner continuation of existing export/recovery work. ADR40 adds a separate closed nonlogin definer for17 safe current app-session metadata columns and two actor-scope columns; existing owners/readers and credential exclusions remain unchanged. No business/financial/Calendar rule, ordinary runtime grant or production permission expansion. All30 prior SQL and original manifest remain immutable; same12 distinct amendments, ten other amended documents byte-for-byte unchanged.

ARCHITECTURE_DECISIONS.md: prior amended SHA256 6cfa0adf14319e7e900fb7986a48ee76cf9b1479500df70e08e1be2e7b786622, 36739 bytes at PR54/main63b2d98f6163e015d8aff4605c20ac04f7f0391c; now version1.11, SHA256 3065eda1d9f1f67fbdb0d2f0faabbc29ee2b69035d98c72a46e5ec3bd84bdd35, 41159 bytes. Original baseline hash/length retained.

PUBLICATION.md: prior amended SHA256 7a1ee8028deee681206a33a070fba12b938142ae44f3810e46967020179879b5, 5853 bytes at PR54/main63b2d98f6163e015d8aff4605c20ac04f7f0391c; now version1.6, SHA256 91707d64d4479dccb7276c1fe0e56435569df4fc8ad54dbcceb50b5574980bee, 5854 bytes. Original baseline hash/length retained.

## 2026-10-24 - Customer directory and synthetic construction overlap

Under the owner's ongoing implementation/efficiency request, ADR41 and ROADMAP1.6 explicitly overlap synthetic Phases3/4 construction so genuine domain parents can support typed files. No V1 scope, acceptance, accounting, data/privacy/recovery or real-data/production gate is waived. Migration32 adds isolated customer command/integrity ownership and typed web/domain snapshot routines; existing owners and previous privileges remain intact with only the listed customer/helper grants added. All31 published SQL remain unchanged. Preserve immutable original baseline/manifest and all original amendment hashes. Same12 distinct amendment entries; nine other amended documents unchanged.

ARCHITECTURE_DECISIONS.md: prior amended SHA256 3065eda1d9f1f67fbdb0d2f0faabbc29ee2b69035d98c72a46e5ec3bd84bdd35, 41159 bytes at PR66/main8dc8d16ef9868490197db412b88a46d6b8f9b3ff; now version1.12, SHA256 cb82df85e1503bbe44193c1fb6d5bdf5f51d4c8f09609b1e6e3434dd04ef65f6, 44926 bytes. Original baseline hash/length retained.

ROADMAP.md: prior amended SHA256 9d71c24347c64fb3c6f46a355b82cfcd9954f4356e08af75fe648e7c7f99ecba, 10200 bytes at PR66/main8dc8d16ef9868490197db412b88a46d6b8f9b3ff; now version1.6, SHA256 48f297ee47a7e3c455308165d551b47af131a9056143715c7d190ed4e726c4d8, 11259 bytes. Original baseline hash/length retained.

PUBLICATION.md: prior amended SHA256 91707d64d4479dccb7276c1fe0e56435569df4fc8ad54dbcceb50b5574980bee, 5854 bytes at PR66/main8dc8d16ef9868490197db412b88a46d6b8f9b3ff; now version1.7, SHA256 c9d6f8ae426b680ba03b686b559860e685834b551866f1423ea6b2131e2d8bd9, 5855 bytes. Original baseline hash/length retained.
