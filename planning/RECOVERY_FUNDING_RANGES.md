# Original funding ranges during recovery

The shared financial recovery collector now checks original fund-lot source
ranges and typed consumption closure after the existing receipt-root checks.
Every query uses the same genuine read-only repeatable-read backup snapshot.
It adds no grants, definer execution, posting rule, migration or wire field.
Both source backup capture and restored-database verification run the checks.

Each lot must resolve exactly one original range through its registered source:
allocation unapplication, held/direct-tip receipt, single collection recredit
or grouped collection settlement. Its original cents must equal that range's
length and the range must remain inside its original funding partition. Bounds
are original payment offsets, not a new1..lot-length numbering. The queries
follow the registered customer_fund_lot_origin and direct-tip posting contracts
without executing those privileged application helpers.

Each fund-lot consumption stays within that original range. A running maximum
of all earlier endpoints rejects overlaps, including nested overlaps that an
immediate-neighbour-only check would miss. Its one typed reference must match
the exact lot and offsets of an application, original tip, service refund,
excess return or held-funds collection-failure component. Reverse matching
also rejects a source action with a missing consumption. Counts must agree.

Restored tips intentionally have no second fund-lot consumption. They retain
the first original tip's consumption and use the registered settlement
generation. The validator checks matching settlement/failure/previous-tip and
posting identities, original lot/range containment and a non-cyclic ancestry
ending at one original tip within the existing180-generation bound. A restored
tip cannot masquerade as a second original fund-lot spend. Settlement components
that declare a restored tip cannot lose that tip silently.

This is not the full financial reconciliation. Economic event/operation/audit
closure, frozen tip net/tax prefix calculations, tip-return/generation spending,
cross-descendant root consumption/recredit claims, AR/AP and money/customer-funds
controls, custody, openings and bank reconciliation remain separate requirements.
Actual owner/provider/security/reopen acceptance remains required. No success
marker, completeBackup:true or fullBusinessReconciliationVerified:true is added.

The native fixture now posts a real1000-cent receipt, unapplies original
offsets101..300 (200 cents), then reapplies151..200 (50 cents). Its exact total
journal debit and credit become26250 alongside the25000-cent invoice. The
restored-only refusal cases move both the application and its consumption
outside the original lot while preserving their matching amounts and journal,
or remove the consumption while leaving its application. Each private target
mutation is restored before the remaining recovery checks; the source is never
changed by fault injection. Advanced variants require their own populated
acceptance; syntax on an empty branch is not that evidence.

Native44/44 on83746fa passes with tracked source unchanged and owned cleanup
awaited in `.local/recovery-funding-ranges138/result.json`. The genuine101..300
unapplication and151..200 application survive source capture and independent
restoration under the current138 restricted reader. Matched application and
consumption shifted to51..100 fail at funding_ranges while exact journal totals
stay unchanged. Removing just the consumption also fails. Original partition
and journal-corruption refusals remain passing. Types and targeted lint pass.

The existing populated registered101 restored-tip workflow separately passes
onb7d204a in `.local/recovery-range-generations138-cycle-assert/result.json`.
It retains actual tip returns, repeated incoming collection failure, source
export and encrypted independent restoration. The new fixed root/range checks
accept both populated source and restored target. A restored-only self-parent
cycle is specifically rejected; restoring the link passes again and reproduces
the exact original inventory. Source remains unchanged and cleanup is awaited.
These supplemental read-only checks use administrative fixture connections;
they do not add a reader role to101 or relabel its frozen recovery format.
Current138 reader permission acceptance remains the separate44-case evidence.

The first supplemental attempt reached the expected cycle refusal but asserted
its error outside the lease wrapper, which intentionally replaces inner errors.
The exact range-refusal assertion now runs inside the snapshot; production code
is unchanged by that correction. The first attempt is retained at
`.local/recovery-range-generations138/result.json`. Single/grouped fund recredit
variants and the remaining economic/tax/generation controls still require their
declared acceptance; this component is not full financial reconciliation.
