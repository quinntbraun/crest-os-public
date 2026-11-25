# Receipt funding roots during recovery

The financial recovery collector now also checks the existing original receipt
root and partition rules using the dedicated backup reader. These are fixed
SELECT queries in the same genuine read-only repeatable-read snapshot as the
dump and financial controls. No role/grant, definer execution, financial write
or schema change is introduced.

Every payment must have exactly one funding origin with the same business,
customer and gross cents, positive USD value and no orphan origin. Original
partitions must refer to that root, have ordinal positions1–180, start at cent1,
continue without gaps or overlaps and end at the exact root amount. Their exact
numeric range sum must equal the root amount. PostgreSQL numeric arithmetic
avoids bigint overflow in boundary/sum checks.

Each customer fund lot must retain its original business/customer/root and
parent-partition relationship. Its positive original cents cannot exceed that
partition. Recredits and restored lots may reuse original roots: descendants
are not required to sum to the root and no fictitious new receipt is created.
These checks derive from ACCOUNTING original-offset lineage and the registered
receipt/held-fund posting contracts. They do not invent a new allocation policy.

The shared financial collector invokes this validator during both source backup
capture and destination comparison. Invalid lineage or incomplete partitions
fail at funding_roots before success. Existing financial metadata remains the
same v1 representation: this strengthens validation without relabelling old
points or changing their digest/profile. The validator does not claim an
independent owner-approved financial reconciliation.

Full root consumption/restoration, event/operation/audit source closure,
receivable/payable/funds/custody controls, openings and reconciliations remain
required. Passing this component does not establish those rules, actual provider
acceptance or a complete backup. completeBackup and fullBusinessReconciliation
remain false. Existing finance export verifiers retain their own scope and
permissions; backup access is not expanded to call them.

Native acceptance on4d031a1 passes42 cases with unchanged tracked source and
owned cleanup awaited in `.local/recovery-funding-roots138-total-fix/result.json`.
The source now includes a genuine command-posted1000-cent receipt against the
25000-cent invoice. Source capture and fresh-process restored comparison accept
its root and partition. A separate restored-only mutation moves the first cent
from1 to2; exact journal debit/credit totals remain unchanged, while financial
controls refuse at funding_roots. The mutation is reverted before the existing
independent journal-corruption refusal. Source data remains unchanged.

The initial run's two archive cases still expected25000 journal cents; the
additional genuine receipt makes the exact debit and credit totals26000. Four
fixture observations now expect that precise total. The failed run is retained
at `.local/recovery-funding-roots138/result.json`. Types and targeted lint pass.
The native fixture populates payment/root/partition linkage; populated restored
and recredited fund-lot variants and the remaining full reconciliation controls
still need their own acceptance. This is a component, not complete accounting
recovery or actual provider/owner acceptance.
