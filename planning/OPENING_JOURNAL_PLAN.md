# Opening journal preparation — not cutover posting

prepareOpeningJournalPlan implements P27 journal arithmetic over a supplied
resolved balance-sheet account inventory, explicit account reviews and typed
opening source descriptors. This is the preparation component of the remaining
opening/cutover work. It is not a new manual journal, client-authorized posting,
approved opening, complete-source verifier or replacement for ACCOUNTING12.
Nothing is wired to a write route, database grant or real business activation.

The existing worksheet/saved opening AR sources remain nonposting. They cannot
currently represent every nonzero opening class, and current financial events
do not yet support P27 origins. This change does not disguise those missing
database/source/reporting/correction workflows as configuration or acceptance.
The full opening objective is retained; no bank-only or zero-only launch scope
is substituted for it.

## Implemented arithmetic and input boundaries

All values are exact integer cents using BigInt, with positive bigint-sized
source amounts and a bounded balancing opening-equity line. No monetary value
passes through floating point. The per-source type/normal-side/control identity
must match its pinned active USD account snapshot and version. Revenue/expense,
contribution/distribution and suspense sources are refused. The balancing account
must be the adopted3000 opening-equity identity; a3100 contribution is not a
substitute. Account IDs/codes and source identities cannot alias or repeat.

The17 descriptors cover bank, wallet, cash, held checks, transfer transit,
owner custody, remaining AR, customer funds, supplier AP, tax liability, debt,
due-owner liability, equipment cost, accumulated depreciation, prepaid, other
verified assets and other verified liabilities. These are proposed bindings for
the future typed P27 sources, not a claim that all corresponding migrations,
mapping purposes, subledgers or owner policies already exist. The normalized
debt control label, for example, still requires its database/mapping registration.
Other asset/liability descriptors accept only noncontrol accounts; they cannot
stand in for an AR/funds/tax/custody control schedule.

Each bank/wallet descriptor represents the whole reviewed book opening for that
actual account, once. Prior historic receipts are not reimported as cash events.
Customer-funds opening contributes its liability leg, never a second bank debit.
Opening AR contributes the remaining receivable leg with no invoice/revenue;
asset cost and accumulated depreciation stay separate. Opening equity can be
debit or credit according to the verified net position. A net-zero position can
still have nonzero gross opening lines. A wholly zero opening requires explicit
evidenced zero/not-applicable reviews; absence of amounts is not verification.

Every supplied non-equity account must have exactly one evidenced review that
matches the derived signed net debit position. Missing, unknown, conflicting,
duplicate and unevidenced reviews refuse. This validates the supplied inventory
only: the transaction must independently obtain the complete real inventory.
Caller-supplied arrays and checksums cannot prove source authenticity, completeness,
party identity, external-identity uniqueness or remaining historical capacity.

The current registered worksheet supplies business-local midnight. Preparation
checks its actual IANA-zone/date/time, retaining PostgreSQL's six-digit instant;
it refuses guessed UTC midnight, nonzero fractions and intraday boundaries.
Canonical intraday cutover remains in scope and needs its complete pre/post
roster and boundary sequence before it can be accepted. It is not silently
converted to midnight or removed from the full objective.

## Immutable plan and retained work

The portable plan copies all account/version, source/version/hash, evidence,
review and boundary material, freezes it recursively and assigns an explicit
line order. Source array order is preserved, not sorted by UUID or used to infer
historical economic chronology. Its SHA-256 covers JSON with recursively sorted
object fields, original array order, UTF-8 text and no added whitespace; the
planSha256 field itself is excluded. This is an exact material comparison, not
a signature, physical evidence or permission to post. Mutating the caller's
objects cannot change retained plan material. Input capacities are2048 accounts,
10000 descriptors and32MiB plan bytes; excess refuses without truncation.

posted, postingAuthorized, sourceClosureVerified and completeOpening remain
false. The future migrated transaction must resolve and compare real saved
sources/accounts/mappings and complete coverage again under the finance and
recovery fences; require D02/D12 authority and immutable approval hash; enforce
one primary opening per cutover; preserve source/external identities; bind the
period, date/order and zero-P&L journal; create typed AR/funding/AP/tax/asset/
custody/timing detail; and retain operation, audit, correction/reversal, export
and independent restoration behavior. It must not trust a JSON plan as authority.

No schema/migration registry, canonical hash baseline, journal record, period,
mapping, recovery epoch, session or approved V1 requirement changes here.

Twenty-nine focused new cases plus all three existing opening-preview cases
pass32/32. They cover all17 kind pins, duplicate bank/wallet book sources,
liability equity direction, AR/no-revenue, cost/depreciation, explicit zeros,
missing/contradictory reviews, source/account aliasing, stale versions, integer
precision/overflow, actual local boundary and immutable canonical hashes. Full
types and targeted lint pass. Initial synthetic fixtures used three-digit time
strings and correctly failed the existing six-digit customerInstant contract;
fixtures were corrected, not the production contract. No native posting,
authorization, source-closure, database or production-cutover acceptance is claimed.
