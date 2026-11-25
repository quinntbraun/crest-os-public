# Remaining opening balance evidence

This is the typed input/preparation boundary for the thirteen P27 source classes
not supplied by the existing bank worksheet, receivable, customer-funds and
supplier-payable schedules. It is implementation toward the full opening
workflow, not an alternative limited opening scope or a usable saved workflow.

Implemented kinds: dedicated wallet, physical cash, held checks, transfer
transit, business-only owner custody, tax liability, debt principal, due-owner
obligation, equipment cost, accumulated depreciation, prepaid, other noncontrol
asset and other noncontrol liability.

The boundary receives a source worksheet cutover and resolved account inventory.
Each nonzero item pins its account/version, retained external identity and
document hash. Type/side/control pins are shared with the journal planner in a
data-only, runtime-frozen module. Nonzero entries require active USD accounts.
No bank, receivable, customer-funds or supplier-payable item is accepted through
this interface, and a noncontrol entry cannot stand in for a control schedule.
The debt control remains proposed until its actual database/mapping registration;
this code does not create, activate or relabel any account.

Each of the thirteen kinds needs an explicit review: unknown, evidenced zero,
not applicable, or source recorded. Unknown stays unknown, including when partial
items have been collected; absence is never verified zero. Source-recorded
classes require items, and zero/not-applicable classes cannot contain nonzero
items. These are retained evidence labels, not financial approval or proof that
the supplied inventory contains every real account.

Amounts use integer cents and exact BigInt arithmetic. Only dedicated wallet
amounts may be signed; negative positions are flagged without inventing loans.
Cash, custody, obligations and the other classes remain positive. One wallet
account/channel cannot appear twice as two whole-book positions.

Transfer transit retains original principal, actual pre-cutover destination
credits, returns and individually evidenced historical fees. The exact remainder
must equal the supplied opening position. A difference is never turned into a
fee. Check receipt/transit departure and fee instants are compared at complete
microsecond precision against the supplied boundary, not rounded milliseconds.
Postdated checks are retained with a review warning.

Asset cost and depreciation are separate items/accounts, linked to one asset
and retained external origin. Depreciation needs that exact cost item, cannot
exceed cost, and cannot be duplicated. Their shared origin is the sole permitted
duplicate-origin pair. No approximate capitalization, depreciation method,
useful life, tax election or remaining prepaid amount is inferred. Missing tax
or capitalization classification and apparently expired prepaid benefits are
explicit warnings. D01/D03 and any real ownership/obligation decisions remain
required; collecting a document does not resolve those decisions.

The result is deeply copied/frozen. It is bounded at1000 items,2048 supplied
accounts and2MiB input. It always reports posted/postingAuthorized/
fullSourceClosureVerified/completeOpening:false. It has no database or network
effects and cannot authorize a journal, payment, expense, contribution or debt.

## Required integration

The held storage part20270219180000_opening_balance_details_storage.sql now
defines four retained tables: origins, typed item identities, schedule revisions
and item revisions. Origins retain unique business/namespace/external identities.
Items pin kind and relevant asset/owner/channel/cost-item identity; owner
references are business-scoped membership references. Schedule revisions retain
the exact worksheet parent, prior-revision chain, operation/audit references and
evidence hash. Item revisions retain sequence, source identity, exact signed
amount and a real historical account-version foreign key.

All four tables force RLS and reject UPDATE/DELETE/TRUNCATE. Only the closed
integrity role receives SELECT. No application writer, finance-owner INSERT
grant, command function, export policy or caller-controlled bypass is supplied.
The evidence envelope itself must retain all nonposting/incomplete flags.
Its4MiB database limit accommodates normalized metadata and PostgreSQL JSON
spacing beyond the2MiB raw-input limit; no value is truncated.

Native storage1/1 onb0aba6e passes
(.local/opening-balance-details-storage), stable source and owned cleanup.
The actual registered142 database accepts the held DDL atomically; all four
tables force RLS, app roles lack writes, even table-owner writes are refused by
RLS, and history-rewrite/truncation attempts fail. All tables remain empty and
the registered142 history and registry bytes stay unchanged. This is not actual
save/history/audit-semantic, stored-row export/restore or source143 acceptance.
Per-kind database resolution, complete item/evidence coverage and semantic
audit/identity guards must be implemented before granting scoped writes.

The held integrity part20270220180000_opening_balance_details_integrity.sql
now checks exact schedule receipts against committed save operations and audit
before/after material. It binds the current worksheet boundary, complete
ordered item representation, recomputed class totals, current active account
versions/type/side/control, duplicate origin/wallet rules, cost/depreciation
identity and amount relationships, and retained identity creation provenance.
New item revisions must match their parent operation/actor, sequence and fixed
asset/owner/channel/cost identities. No writer grant was added.

Native1/1 onf0313c2 passes (.local/opening-balance-details-integrity),
stable source/owned cleanup. A controlled fixture retains two cash revisions
and the exact earlier receipt; missing children, forged audits/commands,
changed totals/boundary, a control-account disguise, orphan origins and stale
account versions roll back. Financial-event counts stay unchanged and the
application role still cannot write. This is a cash/guard fixture, not all-kind
database normalization, command authorization, export/recovery, UI or source143
acceptance. Full authority/context resolution and per-kind database validation
still precede any save grant.

The next coherent migration must provide immutable source origins/items and
schedule revisions tied to the exact existing worksheet revision, including
operation idempotency/conflict retirement, audit records, prior-revision chain,
business/finance/session/recovery fences, private reads and retained history.
The caller's inventory, party/channel/profile references and boundary must be
resolved and rechecked under those fences. Do not trust browser context or a
normalized JSON result as authority. Existing worksheet receipts retain their
original shape and unknown controls; do not rewrite them or cast these new
source labels into historical zero reviews.

The migration and actual command workflow must precede source registration,
fixed-column CSV/Excel exports, neutral reimport, complete recovery inventory,
independent restore and application routes/screens. No schema143 registration
or current export-count change is implied here. The final P27 command still
needs complete authoritative source closure, immutable D02/D12 approval,
one primary opening, full typed subledgers and linked corrections.

Focused details/planner/preview checks78/78 pass, including all class pins,
unknown/zero distinctions, signed wallet precision, duplicate origins/channels,
asset links, transit fees, microsecond boundaries, warnings and unchanged
positive-plan hashes. Types and affected lint are checked separately. No native
database, UI, complete-source or production acceptance is claimed for this
preparation boundary.
