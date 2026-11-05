# Independent journal projection reconstruction

Unregistered schema43 test construction, 2026-10-26. Preceding CSV
source0ef5d07f/candidatefc6603a4/run40436648317 independently passes all1191
database/Auth cases (651foundation/423provider/117Auth), including208proposal
and both complete journal CSV/maximum-original compositions. This accepts the
six reversible114field projections on that source only; full release is
separate. The new independent database reconstruction needs fresh execution.

`tests/support/neutral-journal-import.mjs` imports no formatter, collector,
application schema, migration, command, trigger, provider or extension. Create
a new template0 database and assert absence of auth/crest/crest_private/
crest_commands schemas and presence of only standard plpgsql. Declare a
separate closed inventory of all114 journal fields and six primary keys.
Reconstruct independently decoded CSV rows through parameterized INSERTs into
UUID/integer/bigint/timestamptz/text columns. Do not infer types from cell
appearance or import original JSON as a normalized replacement for text.

Four small reference-key projections from the same captured foundation
provide business/actor/membership/original-operation IDs. These are keys, not
complete restored foundation records or credentials. Enforce their relationships
and journal references to them, tenant-scoped job/attempt/snapshot/part keys,
current lease, attempt sequence uniqueness, generation/part ordinal/object-key
uniqueness, complete snapshot/intent bindings and original verification hash
bindings. Domain checks enforce finite instants, positive versions and size
bounds, original UTF8 SHA256/unique-key JSON, exact15minute attempts and
seven-day completion expiry. No production schema or migration changes occur.

Independent relational queries additionally check attempt counts, snapshot
metadata and the hash of its original plan JSON text, source claim binding,
planned file count/bytes, intent fields against their actual planned parts and
original request, exact verification text, and completed-job/version/actor/
operation/epoch consistency. Ready must include every planned intent and
verification in original order, with exact original plan and part JSON text.
A matching self-reported hash alone cannot establish these relationships.

Select every114 fields back, explicitly formatting timestamps to UTC six
fractional digits and bigint versions to decimal text, and compare each entire
row with independent CSV output. The test also sends decimal values above
JavaScript's safe range, up to PostgreSQL's maximum bigint, through actual
PostgreSQL typed parameters and text output. This is a type probe, not an
invented production history. Keep all original request_text bytes, including a
genuine command-generated12MiB Ready original and its leading whitespace.

Thirty damage checks use target-only savepoints: six duplicate keys, six
foreign business scopes, four damaged originals, missing job/lease links,
completion/verification hash bindings, expiry/lease/version/size/UUID errors,
an invalid current lease, missing referenced actor/original operation, a
rehashed changed Ready plan and deleted verification facts. SQL constraints
or independent semantic checks must reject each case. Roll back every probe,
repeat all consistency/114field comparisons and commit the unchanged target.
Finally prove the source job/attempt/snapshot/intent/verification/completion/
operation/audit evidence is unchanged by reconstruction.

One additional actual PostgreSQL case extends209proposal/1192database/Auth
expected (652foundation/423provider/117Auth). All208 earlier proposal cases
remain. Local JavaScript syntax and changed-fixture lint are useful checks,
not execution of PostgreSQL: the new DDL, FK, JSON and fault-injection assertions
must pass fresh exact-source Linux CI. Application and unit sources remain
unchanged from the preceding5267unit/152file pass.

This is independent journal projection reconstruction with sample reference
closure. It is not a full application restore, complete identity/operation/
audit restoration, encrypted backup recovery, provider migration, authority
reconstruction or whole-business portability. It does not adopt43, activate
worker42, issue Ready/download authority or change any completeness flag.
Next: native acceptance and complete encrypted database/source compatibility
and recovery review before canonical schema43 adoption and runtime composition.
