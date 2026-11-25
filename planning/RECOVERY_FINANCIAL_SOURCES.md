# Financial source roots and event closure

Schema138 recovery controls now require issued/posted source roots and their
financial-event references to agree in both directions. Balanced journal totals
alone cannot detect a source whose financial event disappeared. The check uses
fixed SELECTs inside the existing genuine read-only repeatable-read snapshot;
it invokes no application function and changes no schema, grant or posting rule.

The closed mapping follows the registered financial-event foreign keys and
deferred required-event source contracts: invoices, payments, posted expenses,
allocation unapplications, customer-fund applications, ordinary tips, invoice
credits, service-credit refunds, excess-receipt returns, tip returns, collection
failures, refund-transfer adjustments, collection-failure recredits and grouped
settlements, supplier payables and supplier-payable settlements. Each of these
sixteen roots must have exactly one matching event reference for its business,
source kind and ID. Every populated typed event reference must resolve to its
source, and an event with no known typed source is refused.

Drafts and unposted opening schedules do not become financial events. A direct
receipt can reference both its payment and its tip; this is intentionally not
an exactly-one-nonnull-column rule. Restored descendant tips have no independent
tip event: their existing settlement-component/posting ancestry is checked by
the funding-range verifier instead. Their source roots are not counted again.
Canonical posting/template/amount/audit verification remains the separate
restored-finance step, after the independently pinned routine-catalog check.

The source and destination financial collectors call this check before funding
and journal checks. It returns no new serialized evidence fields or completion
claim. Unsupported schema versions remain rejected by existing entry points.

Native44/44 passes on84f17759 with source unchanged and owned cleanup awaited:
`.local/recovery-financial-sources138/result.json`. The real authenticated dump
is restored into a separate empty cluster, then only the restored invoice event
is removed while all journal rows/totals remain unchanged. The limited reader's
fresh snapshot refuses at source_events. Exact server-JSON restoration preserves
timestamp precision and generated-column rules; the complete original database
comparison passes again. The fresh child reports refusal and its parent asserts
that report. Existing canonical code/payment/range/object/key-kit refusals remain.
Types and targeted lint pass. No real business data is used.

This populated fixture proves invoices, payments, unapplication and application;
it is not fresh populated acceptance of all sixteen families. Historical rich
posting families retain their own tests. Complete AR/AP/customer funds/money/
tax/custody reconciliation, opening schedules, all dependent source components,
security/incident controls, off-laptop recovery and controlled reopening remain
open. fullBusinessReconciliationVerified and completeBackup remain false.
