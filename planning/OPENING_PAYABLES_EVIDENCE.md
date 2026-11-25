# Opening supplier-payable evidence

ACCOUNTING12/P27 requires unpaid supplier bills, original due dates and external
identities in the cutover position. This increment follows the existing retained
opening AR/funds schedule pattern. Original bills less individually evidenced
historical payments and supplier credits must equal positive remaining AP. Only
that remainder belongs in the opening liability; no current expense, payment or
tax recovery is created. Unknown tax and due dates remain explicit. A known due
date may be after cutover. An empty draft does not verify a zero control balance.

The supplier name is a retained source label, consistent with existing supplier
bill drafts; it is not a newly inferred supplier master or proof of legal entity
identity. Source namespace/external bill identity cannot alias across vendors.
The same historical payment can be allocated over several bills: per-bill duplicate
references refuse, but this component does not prove external cross-bill payment
capacity. HistoricalAllocationClosureVerified and FullSourceClosureVerified stay
false. Full reconciliation/approval must resolve those capacities and evidence.

normalizeOpeningPayablesEvidence uses exact positive bigint cents and bounded,
strict fields, copies/freezes source material and preserves original metadata.
The held20270207180000 migration adds immutable origins and worksheet-bound audited
schedule revisions, same-ID save/replay/lookup/retirement and private source snapshot.
It reuses finance/recovery/session fences and the finance-control row lock. Deferred
guards require the committed operation/audit and source row to agree. Vendor/source
origin bindings cannot change silently; normal revisions retain previous evidence.
Ordinary web/direct-table reads remain denied. No new login or posting privilege.

Midnight cutover is the currently supported worksheet boundary; dates on/after it
refuse. Intraday roster/sequence remains unfinished canonical scope. Unknowns and
missing source classes cannot become a complete opening or a primary-system claim.

At the initial persistence checkpoint, root registry/compatibility remained140.
SQL was held/test-only; there was no API/UI,
registered141 release, ordinary export catalog adoption, approval, P27 posting,
production data or installation. Initial native persistence/normalization/audit acceptance passed1/1 on7bffb55c4fd7c30e0d3601f08a589d8ab4f2bb2d
(.local/opening-payables-native/result.json), source stable/owned cleanup. It
verifies exact SQL/TypeScript parity above safe integer range, immutable audit,
replay/read/lookup, conflicting origin/vendor refusals, foreign business/epoch/web
and direct-table denials, deferred orphan rejection, original JSON evidence hashes
and unchanged financial/period rows. Controlled auth only, not genuine HTTP/MFA or
physical file originals. Additional retirement and empty-draft assertions are
pending execution.21 focused units, types and affected lint pass. Next: execute that native boundary, complete retained source packaging/
reconstruction and owner/context integration, then all remaining opening classes
and immutable approval/atomic posting/correction. Do not substitute AP evidence
alone for the full opening objective.

Retirement/empty-draft native acceptance1/1 PASS on94eb8fa475fcfe8df70c7c1ba70f06343b81108c
(.local/opening-payables-retirement/result.json). An absent save can be retired; its
late submission refuses, while a committed original survives retirement review.
An empty third revision keeps prior evidence and verifiedZero=false.

Held20270208180000 export history adds original operation/audit text to the private
snapshot. The source verifier checks worksheet parents, exact original JSON hashes,
revision and before/after chains, bill identity/vendor binding, creating operations
and retirement audits. Four CSV sources, exact JSON/dictionary/escape map, neutral
reimport SQL and a checksummed manifest retain PostgreSQL text and references.
The neutral schema grants no application roles or posting authority. Full registry,
workspace export and API/UI adoption remain closed. Native reconstruction pending.

Native verified source packaging/reconstruction1/1 PASS on25ec9d41faad62cb531b0965635d3f82f662c908
(.local/opening-payables-source-export/result.json). It verifies all3 revisions,
4 original operations/audits including retirement, exact hashes/JSON and bill
identity/vendor, rejects a removed operation, and reconstructs neutral PostgreSQL
text records from the9-file package. Root140 and journal/period counts unchanged.
Source stayed unchanged and owned cleanup was awaited. This is controlled auth,
not genuine HTTP/MFA, actual attachment bytes, complete backups or deployment.

Owner test composition now has private read/save/lookup/retire routes, strict
receipt/cutover/revision/actor comparisons, fresh session/CSRF/edit-binding checks
and explicit openingPayables opt-in requiring the worksheet. Production rejects
this held feature. Existing nested HTTP callers retain128KiB; a separate bounded
opening-evidence entry point supports its1MiB input envelope plus metadata while
retaining duplicate-key/depth/node/encoding/timeout checks. Focused41 client/HTTP/
parser/config cases, types and affected lint pass. Initial cloned test expectations
were corrected to payables lookup/retire routes; guards were not relaxed.

The worksheet screen adds saved supplier balance review, bill editing, original
payments/credits, automatic exact remaining amount, explicit unknown due/tax,
opaque-only pending references and original-save recovery. A new local document
picker computes SHA-256; only reference/hash is sent, no selected file is uploaded
or claimed as a recoverable attachment. Users keep originals. The ordinary records
source label is explicit; no vendor deduplication or legal identity is inferred.
Current root140 and P27/production/complete-source gates remain unchanged. Native
MFA/HTTP and actual phone/desktop browser acceptance were initially pending execution.

On source074de52, the genuine local MFA/HTTP/Chrome journey passed1/1 with
unchanged source and owned cleanup (.local/opening-payables-ui-auth-bound).
It covers private save/replay/lookup, stale revision409, retirement, a real
rendered owner edit/save, local document hashes matching the persisted evidence,
revoked-session refusal, unchanged financial counts, and390/1440 viewport
overflow/serious-accessibility checks. Screenshots were inspected. This is
desktop Chrome with viewport emulation, not a physical iPhone check.
The initial stale-save503 exposed missing fixed AP error markers in the session
database boundary; the correction retains acknowledged rollback and exact
SQLSTATE/marker checks and does not expose database detail. The genuine test is
required alongside the opening-worksheet CI group. This evidence does not
register the held SQL, upload originals, post opening journals, approve a complete
backup, or enable production.

The same source passed the actual encrypted database recovery case1/1
(.local/root140-recovery-role-bound). Its current-schema assertion now explicitly
recognizes140 alongside138/139 for the exact closed backup-reader exception;
the default still rejects that authority and all other role checks remain.

Held20270209180000 adds opening-journal context v3 after registered140 and the
two held AP source proposals. It delegates authentication, fresh READ COMMITTED,
worksheet/AR/funds version checks and finance-control locking to v2, then binds
the latest supplier schedule for that exact worksheet to an expected revision.
Absent evidence remains null/revision0; no control review or posting authority
is inferred. Private role permissions, fixed search path, row security and8MiB
capacity bounds follow the existing context. Registered140 remains unchanged.
Native persistence/source reconstruction plus context acceptance passed1/1 on
fb5bf45 (.local/opening-payables-context), unchanged source/owned cleanup. The
case verifies absent/latest receipts, stale/negative revision refusal, ordinary
web denial, foreign-business isolation, explicit unknown supplier control and
unchanged financial/period rows. This does not close cross-bill historical
allocation capacity, remaining opening classes, immutable approval or atomic
posting/correction. No production activation, installation or actual originals.

Historical allocation preparation now has an exact cross-bill capacity checker
in opening-payables-allocation.ts. Each original payment/credit is an explicitly
identified source with vendor, kind, reference, date, original amount and document.
The checker binds every retained bill reduction to that exact source metadata,
combines allocations across bills and refuses amounts above the original after
explicit evidenced allocations outside this schedule. Unused original capacity
is retained; it is not silently applied to another bill or treated as supplier
credit. Source IDs/external identities and vendor/kind/reference bindings cannot
alias. No source is inferred from a shared document fingerprint or amount.
Only selectedAllocationCapacityChecked is true. ExternalEvidenceVerified,
HistoricalAllocationClosureVerified and FullSourceClosureVerified remain false:
the helper does not authenticate external documents, prove all outside allocations,
or persist/approve a review. Persisted original-root/review storage, owner input,
private API, export/recovery and final approval binding remain required. Existing
saved AP schedules are unchanged and cannot claim this new check implicitly.
The focused allocation and existing bill-contract suites pass36 cases, with
types/affected lint passing. Coverage includes cross-bill and outside-allocation
overuse, missing roots, changed vendor/date/document, aliases, exact large cents
and retained unused capacity. This is preparation, not completed reconciliation.
