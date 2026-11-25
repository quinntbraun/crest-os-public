# Financial recovery comparison controls

The database bundle now captures `financialControls` through its same live
read-only repeatable-read snapshot before pg_dump finishes and that snapshot is
released. The encrypted metadata profile becomes
`crest.private-database-recovery-metadata.v2`; earlier v1 metadata remains distinct.
No migration, posted record, role, privilege or business rule is changed.

The collector reads scalar integer and declared zero-scale numeric columns ending in `_cents` in all Crest and
private application tables. It retains each column's signed sum and nonnull
count, table/group row counts, and business scope, including empty tables.
Unknown amount-column types fail rather than being silently omitted. Raw sums
are restoration comparison values, not revenue, profit, balances due or a
substitute for subledger reconciliation. Versioned/corrected rows remain present
and are not incorrectly netted into a financial report.

Every journal entry must have positive balanced effects; orphan, negative or
invalid one-sided lines fail capture. Per-entry debit/credit and line counts and
per-account trial-balance debit/credit/net values are retained. Zero-effect events
without entries remain valid under the existing financial rules. Account totals
must equal the captured entry totals. Calculations use PostgreSQL numeric and
JavaScript BigInt, and every amount/count is emitted as exact decimal text.
No monetary value is converted through JavaScript floating-point arithmetic.

This provides same-snapshot ledger controls and exact amount-column observations
to compare after independent restoration. It does not certify all source/root,
AR/AP/funds/custody/range, opening, period or reconciliation business rules;
`fullBusinessReconciliationVerified:false` and `completeBackup:false` stay explicit.
The complete point and off-laptop finance acceptance still require their canonical
controls and reviewed owner setup. Backup comparison values do not authorize
financial resumption after an incident.

The collector requires the genuine live snapshot capability and uses only SELECT,
local session settings and read-only cursors. It grants no definer execution or
posting authority. Bounds are2048 amount columns,10000 groups per table,100000
control observations/entries/accounts and8MiB encoded metadata. Exceeding a bound
fails rather than truncating. The existing query/capture deadlines still apply.

Native acceptance onfa3b6bc passes19 cases with source unchanged and owned cleanup
awaited in `.local/recovery-financial-controls138/result.json`. A protected-command
invoice supplies actual25000-cent balanced journal effects. Synthetic signed/null
columns prove exact sums beyond JavaScript safe integers and PostgreSQL bigint
using declared numeric(24,0). Independently restored controls agree; deliberate
corruption of only the disposable restored journal is refused. Initial failed
attempts remain separate evidence and are not included in the passing count.
