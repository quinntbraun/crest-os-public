# Independent restored application schema protections

The offline restored-finance verifier now checks a schema catalog in the same
read-only snapshot as its routine-catalog and event verification, before taking
the integrity role or invoking application code. Exact rows and canonical
routines alone do not prove that row policies or integrity triggers survived.
No migration, schema protection, grant, runtime authority or financial rule is
changed by this component; system catalogs are read with fixed SQL only.

The observation covers the three application schemas: crest, crest_private and
crest_commands. It records schema/relation owners and effective ACLs; relation
kind, persistence, RLS/forced-RLS, options and view definitions; column types,
positions, nullability, defaults, generation/identity, collation and grants;
constraint definitions, validation and deferred flags; index definitions and
valid/readiness flags; policy commands, roles, USING/WITH CHECK and permissiveness;
ordinary trigger definitions and enablement; and internal integrity-trigger
function/type/constraint/enablement metadata. Internal generated trigger names
and installation OIDs are excluded, not the protections they identify.

Type metadata/enum labels, inheritance, rewrite rules, sequence settings,
static nonlogin Crest memberships and application default grants also contribute.
Sequence current values and table rows remain separate data-inventory controls.
Names/signatures and fixed C ordering allow comparison across independent
PostgreSQL17 clusters. Bounds are32768 observations and16MiB; excess refuses.
Only count, profile and SHA256 leave the collector, not raw schema text.

The baseline is generated from a separate empty PostgreSQL17.11 database after
applying the exact reviewed138 migration registry, never learned from the
restoration. Profile crest.application-schema-catalog.v1 has15454 observations
and SHA2563b5a46daddbe45b63ba435bd2f3544e091cd52f18de6b9a39d6a6409afe35ae9.
Registry SHA256 is9d4864f71e8641a6972b4a5db4b1e47bf58f3917ebab34f27e1802226d72236a.
Generation/cleanup proof: `.local/recovery-schema-baseline138-final/result.json`.
Future registry changes require a separately reviewed baseline; mismatch never
automatically regenerates it or allows a partial catalog.

Native44/44 passes on56790035, source unchanged and owned cleanup awaited:
`.local/recovery-schema-protections138-final/result.json`. The actual restored
dump matches the baseline. An unexpected application table, changed payment
SELECT policy and disabled internal payment FK trigger each refuse at schema.
Exact repair passes the canonical four-event posting verification again. Existing
missing-event, routine/payment tamper, ranges, objects and owner-kit checks stay.
Types and targeted lint pass for the component and affected fixtures.

The first native attempt on07a89684 correctly refused the unregistered numeric
test table in crest (42 passes,2 nested/parent failures); its evidence remains in
`.local/recovery-schema-protections138/result.json`. The fixture now temporarily
relocates that test-only table to public for the coordinated run cases and moves
it back afterward. Its original encrypted snapshot, full data comparison and
exact large-integer assertions remain unchanged. The production collector and
independent baseline have no test-table exception.

This is structural application-protection verification, not complete incident
acceptance. Provider/auth/system schemas, external extension code, server/host/
network configuration, credential custody/revocation, physical isolation and
controlled reopening remain separate requirements. The tool still reports
securityAndIncidentAcceptance:false, runtimeActivated:false and
completeBackup:false. Full financial/global reconciliation remains open.
