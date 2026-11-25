# Opening source resolution — held database migration

The held20270201180000_opening_journal_context.sql migration adds a bounded
private source reader after registered138. It is not registered/adopted139 and
no application route invokes it. No canonical registry/hash, financial source,
opening approval or posting is changed. It is the database source-resolution
step before immutable approval/storage and the actual P27 transaction.

review_fictional_opening_journal_context requires the existing finance.post
authority, fresh/recent session/recovery binding and the existing private
finance-preview service role. Ordinary web/PUBLIC has no execute permission or
new table grant. It requires caller-owned READ COMMITTED, preserving the existing
fresh mutation-authority contract. That authority holds shared business/identity/
session/recovery fences; the reader additionally holds a shared finance-control
row lock until the caller ends that transaction.
It clears untrusted context settings before authorization and then establishes
the verified actor/business scope. It creates no operation or audit record and
does not represent a mutating approval.

Within those business/finance fences it resolves the latest saved worksheet and saved AR
schedule, checking both requested revisions; current complete balance-sheet
account identities/latest versions; and the latest mappings effective at the
cutover date. It retains inactive accounts and disabled/missing mappings
explicitly rather than treating them as zero or silently excluding them.
The current eligible dedicated-bank inventory must still match the saved
channel/version/account pins exactly. A changed business timezone or worksheet
boundary refuses instead of reinterpreting retained evidence.

The source receipt is preserved verbatim. A separate cutoverAt field uses exact
PostgreSQL six-digit UTC precision for the journal planner; this does not alter
the original saved worksheet's timestamp text or evidence hash. Capture time,
financial event count and commit sequence are observations for a future bound
transaction, not standalone permission to post or evidence of complete source
closure. The response is explicitly a candidate/unregistered context and has
posted/approvalRecorded/postingAuthorized/fullSourceClosureVerified:false.

This is explicitly finance_fenced_read_committed consistency, not an exported
repeatable-read/global database snapshot. Supported account/mapping/worksheet/
financial mutations serialize through the existing finance-control fence, and
business configuration cannot change through the authority's shared business
lock while it is held. The initial RR design conflicted with the established
fresh-read security rule; neither that rule nor the authority function was
weakened to accept it.

The reader is bounded at2048 balance-sheet accounts and8MiB response bytes. It
never calls a truncated account list complete. All supported controls, typed
nonbank sources, external identities, opening corrections and intraday roster/
sequence remain required for the full P27 implementation. Account mappings and
source data still need authoritative resolution and comparison again during
the actual approval/posting transaction; neither a returned JSON object nor
the planner's hash can replace that check.

The planner now retains explicitly reviewed inactive zero/not-applicable
accounts while refusing nonzero source legs to inactive accounts. The opening
equity account itself must be active. This avoids losing required inventory
merely because an unused account was archived.30 new plus3 existing opening
preview cases pass33/33; full types/targeted lint pass.

The expanded native fixture passes1/1 on2de0100 after exact registered138 plus
the held migration. It exercises saved-source/account/mapping->plan composition,
inactive zero inventory, a later disabled mapping versus the cutover's original
mapping, ordinary-role/wrong-business/recovery/revision/RR/serializable denials,
timezone drift, account version changes, newly changed bank inventory, a competing
finance lock and unchanged financial rows/138 registry. Provider/auth context is
the existing controlled database fixture, not genuine hosted MFA. Source bytes
unchanged and owned cleanup awaited: .local/opening-journal-context-bound/result.json.
The earlier smaller native case passes separately onbc90186. Originald5edd6a
RR setup failure is retained in .local/opening-journal-context/result.json; the
existing fresh-read guard was honored, not relaxed. Actual full typed-source/
approval/posting/export/restore integration and real-use gates stay open.

## Saved customer-funds context v2

Held migration20270203180000 depends on the existing context and customer-funds source proposals. It leaves the v1 function and document shape intact, adding a separately named v2 function with an expected customer-funds schedule revision. The original authority, READ COMMITTED and finance-control fences run first; the exact latest saved schedule belongs to the resolved worksheet. Missing schedules use revision0/null, never implied zero. Stale funds revisions refuse. The result retains the full original schedule receipt and provenance, with profile crest.opening-journal-context-candidate.v2. Unknown parent controls and all unapproved/incomplete flags remain unchanged. The combined document remains bounded at8MiB.

Actual native1/1 on e224fe10e886213c825dd11de4daa73d50d402bc passes in .local/opening-funds-context/result.json (source stable, owned cleanup awaited). Registered138 plus all three held proposals, controlled authority only. A saved15000-cent receipt with5000 historically applied resolves to10000 held across two customer items. The actual saved receipt/account/mapping context composes into a10000-credit customer-funds line and10000-debit opening equity; no second bank debit or receipt appears. Full source closure, posting and approval remain false, the parent customer-funds control remains unknown and financial/period counts stay unchanged. Stale revision and ordinary-role denials pass; v1 still returns its original profile without customerFunds. Existing storage/source-history cases remain included. No139 registration, genuine MFA, posting/runtime route or independent restore is accepted.
