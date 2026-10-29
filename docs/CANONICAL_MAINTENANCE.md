# Public canonical maintenance

Version: 1.4 | 2026-10-27 | ADR43 source-export journal registration

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

## 2026-10-25 - Explicit unresolved nonfinancial-operation retirement

The owner's ongoing implementation/efficiency request authorizes closing the finite lost-draft workflow dependency. ADR42 selects an immutable audited retirement competing on the existing original operation claim; fresh recent owner/current recovery authority and exact original evidence remain mandatory. A committed original stays unchanged; absence is not a terminal decision. No financial cancellation, undo, automatic retry/replacement, draft reconstruction, authority from IDs, paid service or production approval is introduced. ARCHITECTURE1.7 cross-references this explicit protocol and PUBLICATION1.8 advances the register. Same12 distinct amended documents; nine other amended documents, original baseline manifest/identities and all41 prior SQL remain unchanged. Registered42 copies the proven executable exactly; its historical proposal comment is retained provenance, not the registration authority. Independent registered recovery and full consumer/release gates remain required.

ARCHITECTURE.md: prior amended SHA256 3b404f7d81b2c02ece6761881989a275909c82db295a603aafde8f33149f97e4, 38006 bytes at accepted-main integration6e3604d5384c03d50315adf7586b82700edcd710; now version1.7, SHA256 a6322ebe8d030ee1875bdae1e976a2372af8a12da06f6253eb973d005613dbd1, 38680 bytes. Original baseline hash/length retained.

ARCHITECTURE_DECISIONS.md: prior amended SHA256 cb82df85e1503bbe44193c1fb6d5bdf5f51d4c8f09609b1e6e3434dd04ef65f6, 44926 bytes at accepted-main integration6e3604d5384c03d50315adf7586b82700edcd710; now version1.13, SHA256 067b07cccee091ef3c4018e3a42d76bfdcf467664b8100ca68bdfce25861c68b, 49984 bytes. Original baseline hash/length retained.

PUBLICATION.md: prior amended SHA256 c9d6f8ae426b680ba03b686b559860e685834b551866f1423ea6b2131e2d8bd9, 5855 bytes at accepted-main integration6e3604d5384c03d50315adf7586b82700edcd710; now version1.8, SHA256 14dcd0b082ee74abd1d6c760bee09e9111b32d9e199963e06a37577880808e85, 5868 bytes. Original baseline hash/length retained.

## 2026-10-27 - Registered source-export journal and explicit recovery profiles

The owner-authorized export/recovery implementation now constructs ADR43/migration43 from seven retained proven SQL bodies. Keep all42 prior SQL and the immutable baseline/manifest/original amendment identities unchanged. The same12 distinct amended documents remain; only the five listed current versions/hashes advance. Registration is a technical construction decision, not route activation, production permission, complete-backup certification or a business/financial/Calendar scope change. Genuine registered43 catalogue/upgrade/Auth/independent restore and complete source-specific browser/build/container/artifact acceptance remain mandatory. planning/SOURCE_EXPORT_SCHEMA43_ADOPTION.json records exact migration/body provenance; see planning/PHASE_4_SOURCE_EXPORT_ADOPTION.md for execution gaps.

ARCHITECTURE.md: prior amended version1.7, SHA256 a6322ebe8d030ee1875bdae1e976a2372af8a12da06f6253eb973d005613dbd1, 38680 bytes at source00f21d77851e7603d99b8912bd6c1eeeda2e877b; now version1.8, SHA256 12890f037e599232634e39823eeb978c8674585643bb54f66ad9ba06212d37ca, 39230 bytes. Original baseline hash/length retained.

ARCHITECTURE_DECISIONS.md: prior amended version1.13, SHA256 067b07cccee091ef3c4018e3a42d76bfdcf467664b8100ca68bdfce25861c68b, 49984 bytes at source00f21d77851e7603d99b8912bd6c1eeeda2e877b; now version1.14, SHA256 795c07717f9e6b6f3a0bc2875ef2c544bce70281d1cc125e74e6beef8bf10ef8, 54550 bytes. Original baseline hash/length retained.

DATABASE.md: prior amended version1.5, SHA256 7b51a2362d6b9bfe302a1a012bc38d97fe66d6db5558f56048af0009d2b6cd93, 54943 bytes at source00f21d77851e7603d99b8912bd6c1eeeda2e877b; now version1.6, SHA256 044a64693667be29ceee6ebbf58fd136b9cdf799d18138e7c4911d1ada001113, 55826 bytes. Original baseline hash/length retained.

EXPORTS_AND_BACKUPS.md: prior amended version1.5, SHA256 162b73eb711eee6562f04518d156744954d1f45c6831372086e92ac5f50ae27c, 28282 bytes at source00f21d77851e7603d99b8912bd6c1eeeda2e877b; now version1.6, SHA256 cb419895a528c8b5d9196326f63341d1df581846c8c5cf47390f8917948dd468, 29492 bytes. Original baseline hash/length retained.

PUBLICATION.md: prior amended version1.8, SHA256 14dcd0b082ee74abd1d6c760bee09e9111b32d9e199963e06a37577880808e85, 5868 bytes at source00f21d77851e7603d99b8912bd6c1eeeda2e877b; now version1.9, SHA256 fb23f2c00ec0b81d4d46013081d768e71d35a5cdb8635d9c267537e6a33a41dd, 6258 bytes. Original baseline hash/length retained.


## 2026-10-28 — ADR44 catalog construction registration

Reason: advance the approved catalog→quote workflow by registering its accepted storage/command/source/recovery layers with append-only provenance. Registration is construction; runtime44 export/admission/editor and every production/real-data gate remain required. No original manifest/baseline/previous migration/proposal body or exclusion changes. See planning/CATALOG_SCHEMA44_ADOPTION.json.

| Document | Prior version | Prior SHA256 | Prior bytes | New version | New SHA256 | New bytes |
|---|---|---|---|---|---|---|
| ARCHITECTURE.md | 1.8 | 12890f037e599232634e39823eeb978c8674585643bb54f66ad9ba06212d37ca | 39230 | 1.9 | a30e17f994e3ef0a131fe263e12beac23e1743dfeb4262538fc105e6153fba15 | 39590 |
| DATABASE.md | 1.6 | 044a64693667be29ceee6ebbf58fd136b9cdf799d18138e7c4911d1ada001113 | 55826 | 1.7 | 5f327467ce74fbbbda987c09c29b6853ebdcd2bc45f344e493abae4500fc934c | 56232 |
| EXPORTS_AND_BACKUPS.md | 1.6 | cb419895a528c8b5d9196326f63341d1df581846c8c5cf47390f8917948dd468 | 29492 | 1.7 | 37017d2c1a3f4523737d5aad9843aa6502a75baf1f4031c77d413df3dc93db10 | 30279 |
| PUBLICATION.md | 1.9 | fb23f2c00ec0b81d4d46013081d768e71d35a5cdb8635d9c267537e6a33a41dd | 6258 | 1.10 | 0d21cdb14601c80292add46dd97134dfa36df975d0ba3da6939197751b788ead | 6656 |
| ARCHITECTURE_DECISIONS.md | 1.14 | 795c07717f9e6b6f3a0bc2875ef2c544bce70281d1cc125e74e6beef8bf10ef8 | 54550 | 1.15 | 72f4009a4e31bfcf680db11325923195763179c2ff98bff1bd9a333cf592e6f2 | 56726 |

ADR44 sequencing clarification: the bounded genuine synthetic catalog editor depends on actual44 domain authorization/history/concurrency, common-format retrieval, isolated recovery and browser acceptance. Complete business portability remains phase11 and a real-data/release gate; no requirement is waived or scope omitted. This corrects an over-broad construction dependency, following the owner's early usable-build instruction and existing ROADMAP/ADR41.


## 2026-10-28 — ADR45 retained Draft quote registration

Authority: owner-approved V1 implementation in the existing proven architecture. Finite requirement: adopt the reviewed Draft quote save/read/source/original-reference dependency atomically, prove actual current-schema upgrade and isolated recovery, then expose the genuine synthetic editor for browser acceptance. Full current business exports/Excel/worker/admission and all later quote/operational/financial/Calendar scope remain required; no production or real-data gate is weakened. Changed versions: ARCHITECTURE1.10, ARCHITECTURE_DECISIONS1.16, DATABASE1.8, EXPORTS_AND_BACKUPS1.8, PUBLICATION1.11. Original baseline manifest and all44 existing migration bytes remain unchanged. Prior amendment bytes retained here:

- ARCHITECTURE.md v1.9 — a30e17f994e3ef0a131fe263e12beac23e1743dfeb4262538fc105e6153fba15 (39590 bytes)
- DATABASE.md v1.7 — 5f327467ce74fbbbda987c09c29b6853ebdcd2bc45f344e493abae4500fc934c (56232 bytes)
- EXPORTS_AND_BACKUPS.md v1.7 — 37017d2c1a3f4523737d5aad9843aa6502a75baf1f4031c77d413df3dc93db10 (30279 bytes)
- ARCHITECTURE_DECISIONS.md v1.15 — 72f4009a4e31bfcf680db11325923195763179c2ff98bff1bd9a333cf592e6f2 (56726 bytes)
- PUBLICATION.md v1.10 — 0d21cdb14601c80292add46dd97134dfa36df975d0ba3da6939197751b788ead (6656 bytes)


## 2026-10-28 — ADR46 exact owner quote review registration

Authority: continuing owner-approved V1 implementation. Finite requirement: register verified v2 assessment-backed Draft review/approval, preserve exact v1 original results, prove current upgrade/retrieval/independent recovery, then allow bounded genuine synthetic browser acceptance. Send/acceptance/agreement/replacement/amendments and every remaining approved V1 requirement remain visible; no tax/finance/real-data/production gate is relaxed. Original baseline and all45 existing migrations remain unchanged. Prior amendment bytes:

- ARCHITECTURE.md v1.10 — f8a64dec11cb17ac2d34b4fbe7ab9646fdb91a12577830189c4599ff32fe00da (40081 bytes)
- ARCHITECTURE_DECISIONS.md v1.16 — 03373d6be2d5cb054cf36cff5e3a8c51a87dbe8146df4293ce6746f4b1629109 (58655 bytes)
- DATABASE.md v1.8 — 466c0440ac290f20d92f4239c39637f99f4e5efe708f64fec707bfa02111be35 (56761 bytes)
- EXPORTS_AND_BACKUPS.md v1.8 — 9cae0f502ec47327523c54f11632d7299c1f6bc252e6b9d30825edaeba039790 (30837 bytes)
- PUBLICATION.md v1.11 — ea78c0ce35a80996e6110ea637e7885017f3ec297cd8387204b10507c9a53511 (7057 bytes)


## 2026-10-29 — ADR47 retained unconfirmed appointment proposals

Owner-authorized continuation integrates the exact publicly reviewed appointment source as a forward47 migration over46. No original manifest/hash,46 SQL, financial rule, confirmed booking/acceptance or production gate is changed. Twelve distinct amended documents remain; only four current amendments advance.

ARCHITECTURE_DECISIONS.md: prior SHA256 cf2dae92debdd5d88b42dc80c741ba79efdc52b71f9a4e5c3f06fd97f8363221, 61059 bytes; now version 1.18, SHA256 2a7a79d5ae3fe0c1ca2c1fdb2f46c4e6d6cfa2d62133553dfa7dc006cf050953, 63245 bytes.

DATABASE.md: prior SHA256 bd771b0870aaa2b4c02f63ab6bb51edc20671f6a343df6402d61b0f1abe4fb25, 57471 bytes; now version 1.10, SHA256 87c9f594231f27d96dba68fb067182203ba217fcdd00ae7f5ec865357a989017, 58214 bytes.

EXPORTS_AND_BACKUPS.md: prior SHA256 fde08fbf440df8852f4e1c1e6189c896008fbeb1bfd8d8ee700ea0278a718f90, 31637 bytes; now version 1.10, SHA256 4829d201eee975423191d0ca535cfd196bc1253f7d02ca96edd6aa123f1af221, 32627 bytes.

PUBLICATION.md: prior SHA256 fd772eb250879cab7b769497ed21311e9d94cee77b793dddd6630dd9a5e834a4, 7477 bytes; now version 1.13, SHA256 0f0048eb6e4179ab0f62ceacbe1fc0fcfd49de61e69563ca3482e37485086081, 7830 bytes.
