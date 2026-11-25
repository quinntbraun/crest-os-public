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

Root registry/compatibility remain140. SQL is held/test-only; there is no API/UI,
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
