# Retained provider source export

Registered schema135 adopts the reviewed SQL in
`20270128180000_provider_source_export.sql`. The preceding proposal remains as
provenance. Registry checksum, compatibility maximum and source inventory are
explicitly135; no existing migration is edited. Production activation remains
blocked and real Crest use is not accepted.

The remaining actor component consists of eight fixed provider login, cleanup,
inventory and session-event tables. Required columns come from the existing
SECURITY_EXPORT_COVERAGE inventory. The reader verifies the business
identity closure and each actor's actual provider issuer on the caller's read-only
repeatable-read transaction. It exposes only these fixed columns through one
security-definer function granted to crest_export. Its internal owner has no login
or memberships; forced row policies enforce the selected actor/issuer. No web
table reads, write permission or credential-table access are added.

The server component preserves original scalar text, canonical evidence and
event hashes, combines actor pages in primary-key byte order, and verifies exact
CSV decoding including nulls, empty strings and spreadsheet escaping. It does not
claim reference closure, complete portable export or complete backup.

The schema135 request function is separately named. Existing43/134 jobs,
requests and receipts keep their source identity; snapshots remain bound to the
exact job tuple. The current execution adapter and production runtime request135;
stale134 requests are rejected before provider/database I/O. Historical134
downloads remain supported. The worker has an explicit134 compatibility option;
its135 path requires the provider component. The collector captures that
component only for exact135 migration identity, on the existing read-only
transaction. Financial vocabulary remains109; unknown136 stays distinct.

Verification:40 focused cases across provider, identity, session and neutral SQL
import pass, with type checking and targeted lint. The source-frozen native case
passes on03ccf1cd5be18e53d198e54f02934687f34a2814. It seeds all eight tables through
original commands, compares every exported cell with actual PostgreSQL values,
verifies paging and permission refusals, checks old134 replay after the proposal,
explicitly stops the old job and admits a fresh135 job. The combined package
imports179 source tables into a separate empty database, retaining every provider
cell; a second import refuses to overwrite the existing schema. Owned fixture
cleanup completed. Earlier held evidence is preserved as
.local/provider-source-native/scoped-d135497-result.json and its test.log;
the full179-table held import passed on03ccf1c. Initial SQL ownership setup
was corrected to the established schema-owner/create/transfer/revoke sequence;
two fixture setup corrections retained the original guards. Only disposable
synthetic data was used. This is held-proposal verification, not registered135,
full release or independent off-laptop recovery acceptance.

Registered135 full current export native verification passes on9d70806 with
unchanged source and completed owned cleanup. It exercises the actual encrypted,
audited worker, complete and selected-file download, neutral reimport and Stop/
fresh-job controls, alongside the existing Calendar credential journey. The
original registered134 case also passes on that same source. First231b7a2
failed at worker construction: its version option reached the closed core
configuration. The wrapper now removes only its reviewed version option before
the unchanged core guard. Original failure is retained. Evidence:
.local/current-export135/result.json and .local/current-export134/result.json.
These synthetic tests are not actual Google, hosting or owner acceptance.

Current source coverage is179 tables:167 business,3 identity,1 session and8
provider. The business workbook remains170 sheets; actor data is in its declared
CSV/metadata and neutral import components. Incomplete portability/backup flags
remain false.215 focused cases across13 files, types and targeted lint passed
before the final worker wrapper correction, which has both native versions
passing. The registered upgrade case with all8 positive tables is mandatory in
test:google-calendar-registered. Its actual134-to135 upgrade passes onac21e17,
including all8 positive command-produced provider tables, exact179-table neutral
import and existing-schema refusal, original134 replay and new135 admission.
Owned cleanup completed and tracked source remained unchanged. Current type
checking, targeted lint and the complete Next/server production build pass on
that source. Compiled build identity is12860802aeec7445b43cddda97b3bc231234afee,
with actual source schema135; this does not unblock production activation.

Next: exact-source release acceptance. The remaining10 runtime/global tables,
complete reference closure, required reports,
original private files, full backup restoration and real owner,
host, phone and financial acceptance remain separate launch requirements.
