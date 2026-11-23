# Canonical posted-account controls after restoration

The offline recovery path now invokes the existing registered report controls
for each captured business with financial events. It does not implement a new
set of accounting rules. The canonical schema109 report context remains the
reviewed function in the exact138 migration registry; the independent routine
and schema baselines must match before any application code executes.

## Separate destination identity

The caller supplies a connected, dedicated, temporary restore-only login with
one SET-only/noninheriting membership in crest_finance_account_owner and direct
read access to the migration register. The login has no administrator, bypass,
role/database creation or replication powers, ordinary table-write or schema-
create privileges. The account-owner group is powerful and must be confined to
the independently fenced restoration, never the source/web/backup scheduler,
and retired after the recovery review. No login or grant is created by the tool.
Backup-reader and integrity-verifier permissions remain unchanged.

The connection is forced read-only, and only inside a read-only repeatable-read
snapshot is the account-owner role assumed. Five-second query and fifteen-minute
operation limits remain. The owned client closes on success or refusal. No
financial record, repair, posting, replay or runtime activation is performed.

## Binding and tenant-filtered coverage

The genuine successful full database comparison privately captures every
financial-event business, exact event count, latest effective date and the time
zone frozen on that latest event, from its same compared snapshot. These values
are capability state, not a new metadata/wire format. Counts must total the
original whole-event fingerprint; the business list is bounded at10000.

Copied success objects are refused. Destination endpoint/server start, exact
migrations, roles,1269-routine identity and15454-observation schema identity
must match the genuine comparison and independent baselines. Tenant-filtered
reads explicitly set the captured business context for every business. Bounded
cursor reads merge all sorted SHA256 row hashes to reproduce the original whole
event fingerprint before and after control execution. No scope can silently
disappear behind an unset tenant context. The event limit remains100000.

For every business, the canonical report context runs through its latest
captured effective date, including supplier payables. Returned business, date,
frozen time zone and exact event count must match. Its six required controls
are ledger balance, receivables, money movements, customer funds, tax payable
and supplier payables. No cutoff can omit a later captured event. The canonical
function rejects unsupported templates/dates and any failed account control.
Only business/count/date/zone and control booleans are retained; refund-due
customer detail from the report is not emitted by this tool.

The date is a captured posting horizon, not a claim about today's active
business time-zone setting. This check and the original data comparison use
separate snapshots: atomicWithDataComparison remains false. The canonical
report's coverage remains explicitly incomplete, with openings excluded and
external reconciliation unverified. No such flags are promoted to success.

## Executed evidence and limits

Native44/44 passes on1f667a73, tracked source unchanged and owned cleanup awaited:
`.local/recovery-posted-account-controls138-totals/result.json`. Two genuine
posted businesses contain five events (one invoice; another invoice, receipt,
unapplication and fund application). Both tenant contexts and event counts1/4
are checked. Copied capabilities and a client using the wrong verifier role
refuse. Increasing only a restored receivable by one cent leaves all journal
rows/totals unchanged but fails the canonical account controls. Exact repair
passes both businesses again. Existing routine/schema/source/range/object/key-
kit checks remain, with no skips or cancellation. Types and targeted lint pass.

The initial727ffcb run is retained41/44: data/run parent assertions stopped
before the new verifier because the fixture expected26250 journal cents after
adding a genuine second25000 invoice. Exact expectations now require51250;
accounting code, guards and every original assertion remain intact.

This run populates invoice/receipt/application/unapplication and AR/money/funds.
Tax and supplier controls execute with empty balances here; this is not fresh
populated restore acceptance for every posting family. Opening, bank/custody,
period/generation and complete global/security/incident acceptance, independent
external restoration, key custody and controlled reopening remain required.
Results retain openingBalancesIncluded:false,
fullBusinessReconciliationVerified:false, securityAndIncidentAcceptance:false,
runtimeActivated:false and completeBackup:false. The report controls do not
authorize live financial resumption or a completed backup marker.
