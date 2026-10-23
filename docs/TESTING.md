# Crest OS V1 - Verification and Release Gates

Version: 1.5 | 2026-10-22 | Owner-requested V1 Calendar contract; implementation and production gated

Calendar scope amendment, 2026-10-22: the owner requested Google Calendar connection support in V1. P20/BR21/ADR35 now require the capability with optional owner activation, outbound-only projection and unchanged integrity/security/recovery gates. This supersedes older optional/excluded Calendar wording only. Current versions and immutable-baseline amendment evidence are in CANONICAL_MAINTENANCE.md; implementation/research and unexecuted provider gates are in [the Calendar contract](../planning/GOOGLE_CALENDAR_V1.md). No live integration or production approval is implied.

Public edition, 2026-10-20: owner-authorized public source; application access and business evidence remain private. PUBLICATION.md records this explicit privacy/provenance amendment and the current authority/version register. Earlier private-repository and budget/authorization statements below are historical where superseded there. No security, accounting, recovery or real-data activation gate is waived.

## 1. Execution tiers and fixtures

M = blocks merge: typecheck, lint, build, unit, affected database/integration tests and security grant checks. D = blocks deployment: all M plus full invariant/integration suites, core browser E2E, migration compatibility, source-ledger controls and deployed staging smoke. N = nightly: randomized sequences/concurrency, longer security/upload/import/export suites, capacity and recovery checks. R = before first production release and material change: full acceptance, real devices, portable export reimport, isolated full restore and red-team regression. Quarterly restore remains required after release. Nightly failure becomes release-blocking when relevant; no "nightly only" escape for known corruption.

Tests run against actual PostgreSQL with production extensions, functions, RLS and grants, not SQLite or mocked ORM. Use Vitest for pure TypeScript, pgTAP/SQL for database guards, integration tests for transactions, Playwright for desktop/mobile browsers, axe-core for accessibility and k6 for capacity. Pin versions at foundation. Never disable RLS to make integration tests pass.

Fixture packs:

- F1 identity: two synthetic businesses, owner+unauthorized identity+disabled membership, revoked/expired sessions, no customer PII.
- F2 CRM: shared household phone/email, two vehicles/two addresses, ownership change, incomplete lead and historical reference rows.
- F3 commercial: $450 offer, $525 two-vehicle bundle, discounts $100.01 each, revisions/amendments, complimentary line, Extreme assessment, tax unresolved and synthetic10% only.
- F4 field: fixed UTC clock, Indianapolis dates and DST boundary examples in alternate supported zone, mobile/dropoff/pickup, two vehicles, pauses/supply trip/cancelled custody.
- F5 finance: $450 invoice, $475 explicit-tip/unspecified-excess variants, $200+$250 receipts, bounced check, $100 credit/refund, $500 transfer/$10 fee, openings, locked period, mixed expense and payable.
- F6 files: generated safe image/receipt/PDF, real synthetic HEIC captured on test phone, corrupt/truncated/oversized/polyglot/decompression-bomb/active-PDF fixtures; no real customer photos.
- F7 import/export: repeated file, repeated provider ID, identical legitimate transactions, missing parents, formula-leading/Unicode/null/backslash text, leading-zero IDs and huge integer cents.
- F8 recovery/capacity: seeded10k customers/50k jobs/1m journal lines,100 GB generated originals, historical schema/image/key versions and intentionally missing/corrupt object.
- F9 Calendar: synthetic Google account/project/dedicated calendar, deterministic provider faults, two devices/workers, DST gap/fold and redacted OAuth/connection fixtures; never real client bookings or credentials in public CI. Actual provider setup/consent remains a separate owner gate.

## 2. Product acceptance matrix

Each row tests all acceptance bullets for that P requirement; the evidence column defines persisted assertions beyond UI text. Detailed test cases retain requirement IDs in code and test reports.

| Requirement | Layers / fixtures | Specific evidence required | Gates |
|---|---|---|---|
| P01 access/setup | DB, API, E2E; F1/F3 | Guessed customer/file/export denied; provisioning only; recovery/revoke works; settings versioned; unknown tax blocks issue but permits CRM | M,D,R |
| P02 lead capture | unit/API/E2E; F2 | Label-only save; no silent contact merge; lost reason/source history and due/overdue follow-up retained | M,D |
| P03 conversion/history | DB concurrency/API; F2 | One conversion, selected two vehicles/addresses preserved, customer creation not Won, archived/changed owner retains job/photo history | M,D,N |
| P04 quote presentation | unit/DB/render; F3 | Approved exact hash, scope inclusion rules, no odor guarantee/internal cost leak, total/discount tax reconciliation, >35min manual prompt, no hidden travel fee | M,D,R |
| P05 immutable agreement | DB/API race; F3 | Supersede/accept serialize; partial acceptance rejected; amendment chain and original rendering unchanged | M,D,N |
| P06 calendar | DB/API/E2E; F3/F4 | Required scope/location/contact, travel conflict query+reason override, reschedule same job/history and confirmation draft, cancellation retains money/custody | M,D,N |
| P07 mobile execution | DB/API/real device; F4 | One leg/arrival, exact60 active+10 paused, timer reload/correction preserves occupancy, unknown ETA/miles explicit, native message only Opened | M,D,R |
| P08 other fulfillment | DB/E2E; F4 | Mobile and Drop-Off enabled; Pickup + Return disabled but functional; receive/pickup not labor; per-vehicle custody and return-required survive completion/cancellation; driven vehicle correct | M,D,R |
| P09 files/completion | API/worker/device; F4/F6 | Correct job/vehicle links, failed upload visible, completion review/finalization atomic, no payment dependency, optout/missing contact reasons | M,D,N,R |
| P10 outreach | unit/DB/E2E; F2/F4 | One primary ask, encounter duplicate warning, manual cadence only, snooze/dismiss/rebook respects unrelated tasks and optout | M,D |
| P11 invoice/receipt | unit/DB/API; F3/F5 | All-in snapshots, partial/split/tip/excess math, concurrent balance cap, pending transfer no settlement, check undeposited not bank, no provider movement claim | M,D,N,R |
| P12 refunds/reconcile | DB/API; F5/F7 | Credit versus failure semantics, remaining refundable components, excess return, transfer/fee matched without revenue, original history retained | M,D,N,R |
| P13 expenses | unit/DB/worker; F5/F6 | Splits/outflow reconcile, repeated receipt not expense, mixed-owner funding correct, missing receipt reason, unresolved assets blocked, reversal replaces | M,D,R |
| P14 miles | unit/DB/E2E; F4 | 26 physical actual miles, estimates separate, no double attribution, no mileage financial posting | M,D |
| P15 ledger | DB/property/report; F5 | Atomic source+balanced journal, no duplicate revenue on receipt, locked-period/unlock invalidation, AR/funds/statement/P&L/BS controls and incomplete openings warnings | M,D,N,R |
| P16 dashboard/reports | integration/query/render; F2-F5 | Dashboard/report same-filter totals, each BR14 metric date/cohort/denominator, missing inputs not zero, no historical metric seeds | M,D,R |
| P17 import/export/recovery | DB/worker/restore; F7/F8 | Repeat batch safe, reference mode nonposting, correct typed data/IDs, one snapshot across formats, attachment bytes, independent restore+auth compatible | M,D,N,R |
| P18 phone | device/E2E/a11y; F1-F7 | 360px width,44px targets, readable contrast, camera/gallery, keyboard/screen reader, suspended/reloaded app, uncertain payment resolution, handoff after committed save | D,R |
| P19 desktop/performance | E2E/a11y/k6; F1-F8 | Full functional parity including exports/reconciliation; p95 outcome/progress<=3sec; large-dataset measured capacity | D,N,R |
| P20 Google Calendar | unit/DB/API/worker/E2E/provider/real device; F1/F4/F9 | GC01-GC18 in planning/GOOGLE_CALENDAR_V1.md: least consent, atomic outbox, actual create/update/cancel, identity/unknown-result/etag/lease races, revocation/budget/disconnect, restore and secret-free exports | M,D,N,R |

## 3. Mandatory adversarial fixture matrix

| ID | Layer and fixture | Assertion / fault injection | Gates |
|---|---|---|---|
| T01 | DB/API F2/F3 | Drop conversion response then retry; exactly one mapping and52500-cent allocated agreement | M,D |
| T02 | DB F3 | Draft v2 concurrent with v1 acceptance; draft cannot withdraw/replace accepted v1 | M,D |
| T03 | DB race F3 | Barrier-controlled send-v2/accept-v1; one coherent winner, no orphan jobs | M,D,N |
| T04 | DB/render F3 | Catalog edit leaves accepted hash/invoice45000 | M,D |
| T05 | DB race F3/F5 | Invoice issue/amendment interleavings; entitlement version consistent; both commit only if compatible | M,D,N |
| T06 | DB F3 | Split visit issuance with distinct operation IDs; consumption ceiling52500; completion retry no billing | M,D |
| T07 | API/clock F4 | Retry both transitions,70min total/10pause; one leg and3600 active seconds | M,D |
| T08 | API F4/F5 | Completion before collection; unique primary review and independent work/payment states | M,D |
| T09 | device F4 | Open SMS then cancel and return; state Opened, no Sent assertion | D,R |
| T10 | DB F5 | Explicit47500=45000 allocation+2500tip; exact source/journal dimensions | M,D |
| T11 | DB F5 | Unspecified excess2500 goes to liability, not tips; visible unresolved lot | M,D |
| T12 | DB F5 |20000+25000 receipts; balances25000/0 and revenue45000 once | M,D |
| T13 | DB race F5 | Two distinct actual receipts race; no negative AR, extra actual cash held in funds; duplicate-evidence review separate | M,D,N |
| T14 | DB F5 | Paid invoice10000 credit then refund; net service/cash35000, AR0, immutable originals | M,D |
| T15 | DB F5 | Bounced45000 receipt; AR45000 and original service revenue remains | M,D |
| T16 | DB F5 | Return2500 excess; funds0, cash45000, revenue unchanged | M,D |
| T17 | DB race F5 | Refund same key retry and different key over-refund; original event once, excess atomic reject | M,D,N |
| T18 | DB/worker F5/F6/F7 | Two images/reimport; one source journal; duplicate warning evidence retained | M,D |
| T19 | DB/reconcile F5 | Transfer50000 minus1000 fee;49000 bank, -50000 clearing,1000 expense; no revenue | M,D |
| T20 | unit/property/DB F3 |11000 inclusive synthetic10%; randomized partial credits sum exact10000net/1000tax | M,D,N |
| T21 | unit/property F3 |52500 and29003 totals; deterministic remainder order;81 not80; zero/full discount no division error | M,D |
| T22 | API/DB F3 | Bypass UI issue with unresolved profile; transaction rejects with no journal/numbered issue | M,D |
| T23 | API/E2E F4 | Cancel held vehicle; return queue persists without release or refund | M,D |
| T24 | API F4 | Receive dropoff; no rig leg or labor until Start Work | M,D |
| T25 | unit/report F4 |12+14 actual plus11estimate =>26 confirmed; no automatic deduction | M,D |
| T26 | DB/render F2/F3/F6 | Ownership/address edit; previous quote/invoice/job/photo customer context byte-stable | M,D |
| T27 | DB/import F7 | Reference paid history plus openings reimport; no duplicate AR/revenue; coverage explicit | M,D |
| T28 | DB/API F1/F5/F6 | Locked-date command plus guessed cross-tenant object; deny both, no partial result | M,D |
| T29 | API/proxy F5 | Sever response after commit; operation lookup recovers original; no new receipt prompt until resolved | M,D,R |
| T30 | worker/E2E F4/F6 | Kill upload midstream, complete; completion succeeds while evidence remains Failed/Pending | M,D,R |
| T31 | export/import F7 | Formula strings inert, long ID exact, decode null/escape roundtrip, all totals same snapshot | M,D,R |
| T32 | recovery F8 | Remove vault original or key; verification fails, never production-ready | N,R |
| T33 | DB race F4 | Phone labor+desktop travel and backdated correction overlap; exclusion catches even direct routine path | M,D,N |
| T34 | DB F5 | Part refund then full reversal; reject or component-aware remaining correction only | M,D |
| T35 | report F5 | Missing opening/cost/time fixtures; warnings and unavailable ratios, no invented profit | M,D |
| T36 | DB fault F5 | Full credit paid invoice: inject crash between unapply and credit; entire transaction rolls back or both commit | M,D,N |

## 4. Additional red-team regression requirements

Use two real DB connections with deterministic barriers, not sleeps, for races. Run each command against wrong business/customer, disabled identity, stale version, reused ID/different payload and direct domain routine calls. Property-based financial sequences include credits, unapplications, refunds, reversals, transfers, openings and period locks; assert semantics/subledgers after every committed step, not only final trial balance.

Required extra cases: same external receipt entered manually and imported with different keys; two legitimate identical cash receipts; pre-reset JWT and app cookie after logout; connection-pool tenant context bleed; security-definer/search_path abuse; provider down during session refresh; token refresh races; malicious PDF and oversized image; signed PUT reused after finalization; expired upload lease; archived evidence still recoverable; link scanner GET cannot accept; missing old encryption key; object lock shorter than retained monthly manifest; old schema with newest app and vice versa; backup scheduler outage while app healthy; entire hosting account unavailable; invoice numbers after point-in-time restore; full CSV reconstruction without provider access; background suspension at every field transition.

Migration tests start from previous two supported release schemas, seed representative posted/accepted data, apply new migration and verify constraints/hashes/totals and old-app compatibility range. Detect table scans/locks on F8 before deployment; set lock timeout and retry outside busy hours. Test failed migration cleanup and checksum drift. Destructive migration needs a recent successful restore plus explicit release approval; no empty-database-only migration tests.

## 5. Measured performance/mobile declaration

Pilot fixture:1,000 customers,5,000 jobs,100,000 journal lines,10,000 attachment metadata rows with representative images. Capacity fixture F8 is separate. Baseline physical phone: iPhone13 on current supported Safari, plus a mid-range Android device selected and recorded at implementation; desktop Chrome/Edge. Reproducible throttle:4 Mbps down,1 Mbps up,150ms RTT, cold and warm navigation; CPU4x slowdown in lab in addition to real device. Measure at least200 ordinary text navigation/save operations across the core workflows; p95<=3 seconds to confirmed outcome or truthful visible progress. Progress must not mask indefinitely slow saves: separately record p95 committed-save latency and reject regressions >20% without review.

Run concurrent phone+desktop edits with export worker and backup active. Record DB query plans, connection/heap limits, queue delay, error rate and upload retry outcomes. Test smallest web instance; if memory cap or latency fails, optimize and remeasure or obtain explicit budget approval for a documented larger instance and update cost estimate; no automatic paid upgrade is authorized. Full exports and restore must meet documented capacity without UI timeouts. Real-device camera/gallery/HEIC/SMS/directions/PWA tests are mandatory; browser emulation cannot prove them.

## 6. Definition of complete and release evidence

A feature is complete when requirement-linked success/failure/concurrency paths pass, data/permission rules live below UI, migration/backward compatibility and audit/export representation exist, user can recover uncertain outcomes, no fake success state exists, and relevant documentation/runbook is updated. A bug fix needs a reproduction and regression at the lowest reliable layer; skipped tests need explicit reason and cannot waive finance/security invariants.

Release evidence records commit/image/schema hashes, test versions/results, source-control and dependency scans, coverage matrix, mobile/profile measurements, restore/export roundtrip results, open defects and D-gate approvals. Tests in this document have not run because no application is implemented. Document review establishes design coverage only. No real-data pilot until D01/D02/D10/D11 and applicable D05/D12 controls and all required R gates are satisfied.

## Budget/owner-decision regression gates - 2026-10-20

Test trusted-device reopen without a login prompt; expiry/revocation still enforced. Simulate 24+ hours without successful backup: ordinary financial posting succeeds, the incident/banner persists and independent alerts reach the owner; a partial backup never clears it. Test provider/DB unavailability honestly fails writes. Same-day matching receipts prompt review but two real receipts can be recorded with explanation; verified transaction identity cannot be reused. Confirm Mobile/Drop-Off enabled and Pickup + Return separately gated. Import the small Urable reference fixture without posting entries. Benchmark actual Free DB size, provider-metered backup egress, cron runtimes and minimum-instance peak memory; record projected spend. The F8 large-capacity fixture is a growth profile, not a required standing cloud deployment or evidence that 500 MB supports 1m journal lines. Preserve full restore/old monthly-point tests using isolated local or temporary resources and cost them.


## 7. Adopted accounting and owner-custody acceptance

F5 includes ACCOUNTING E01-E33, C01-C22, F01-F12/R01-R12 and section26 O01-O10. Required at M/D for affected changes, D/R for full financial/recovery release, randomized extensions N. These are specifications, not executed application tests.

Assert exact accounts, cents, tax/discount ranges, dates, dimensions, funding/cost/custody ancestry and all controls after every committed event/group. Inject failures between every dependent insert; reject with no partial source/journal/reservation/success audit. Tamper both source and ledger customer together and require immutable ancestry rejection. Test real two-connection races under finance lock; no sleep-based race proofs.

| Fixture | Required evidence |
|---|---|
| Funding/openings | Opening funds refund without payment row; opening AR collection without invoice/sale; apply/unapply/tip/refund/failure retains one root and exact capacity |
| Non-last credit | A6/N5/t1: credit3, credit1, reverse first3, credit1 => 3/0,0/1,exact3/0 restoration,then1/0; no negative tax; discounted and zero-price variants |
| Failure distinction | Deposited check failure credits actually debited account; service SR unchanged. Failed outgoing tip refund returns funds liability; retry reduces tips once. Failure after refund uses linked exceptional debit, no fabricated AR |
| Cost dates/lineage | Jan31 cost/AP, Feb2 payment/owner funding; conditional supplier claim then receipt; expense-to-asset/prepaid reclassification followed by supplier return uses remaining current cost destination and original tax |
| Transfer/fee/evidence | Month-end dispatch/partial arrival/return;1060 exact. Embedded fee XOR separate fee; cross-type and overlapping-file duplicate IDs rejected; legitimate equal-amount distinct receipts retained |
| Control ancestry | Used control remap/type/report-role edit rejected; pinned original AR/funds; typed AP/debt/tax/asset/prepaid/suspense schedules tie; generic control journal rejected |
| Legacy/cutover | Paid legacy100 concession produces returns/funds, no new AR/sales; legacy failure creates only enforceable AR; no opening/legacy overlap. Intraday roster and opening-before-ordinary event order tested |
| Reconciliation | B=S+O with full matching; as-of timing clearance; superseded matches don't consume current capacity; backdated changes invalidate dependent approvals. Prior-period corrections cannot masquerade as timing |
| Reports | Original January entry reversed February remains in January; TB openings once; year2 earnings once; completed scope without/deleted draft stays unbilled; prior-coverage corrections bridge; unallocated/missing costs never zero profit assumption |
| Recovery | Restore before committed receipt, old device/new operation key with old epoch rejected; reviewed reconstruction aliases original evidence. Known numbers reserved; unknown high-water new UUID series prevents full-number collision; unresolved money gap blocks clean financial resume |
| Owner custody | All O01-O10, mixed wallet full personal balance excluded; transfer between personal channels not draw/contribution; explicit personal funding shortage; personal spend does not silently consume custody; owner obligation never negative or automatically netted |

For each major workflow, tests trace lead→customer→vehicle→quote→acceptance→schedule→job→invoice→receipt→ledger→review and expense→receipt→ledger→reconciliation. Review creation remains at job completion; this financial test sequence does not delay review until payment. Also exercise funds→application→refund/tip, credit→unapplication→refund, collection failure, transfer/transit, cutover/openings and restore/reconstruct/resume. All still use synthetic data until the established production gates pass.


## 8. Final pre-code audit regression requirements

All cases below are required synthetic DB/API tests at M/D, full recovery/portable roundtrip at R, with randomized variants N. These are unexecuted implementation requirements.

| ID | Adversarial case and exact assertion |
|---|---|
| A01 | Pause a command after HTTP epoch validation but before authority lock; rotate recovery authority, resume: reject before replay/mutation. A transaction already holding shared authority must finish or be terminated before exclusive recovery fence completes. Old operational commands, upload validators and task completions cannot cross it. Old deployment credentials cannot write after switch. Combined commands claim one operation, not nested public claims |
| A02 | Recover a proven lost Jan31 issued invoice on Feb2: original full number/issue/effective date and original source snapshots retained, new reconstruction actor/time/incident recorded; reserved number bound once. Ordinary new invoice cannot claim Jan31 issuance. Missing agreement/tax/ordering evidence blocks; locked January requires audited incident unlock/reclose. Reconstruct dependent credit/payment once without external sending/collection |
| A03 | Opening funds100, supplemental correction+20 => two immutable roots100/20, F120, no cash. Remove30 eligible original ranges => F90, original root live70+removed30=100. Reverse removal once => F120. Already-refunded ranges cannot be removed; dependent applied/tipped ranges require valid atomic plan. Test corresponding AR/custody delta and exact restoration, no current concession/income |
| A04 | Contribution100: convert40 to O, return30 capital => available30, O40. A second conversion/return>30 rejected across kinds/IDs; reimburse20 => O20; convert only remaining20 back to the original contribution lot, restoring its available capacity to50 without a second lot; historical reimbursement20 and converted capacity20 retained. Supplier return cannot consume same cost/contribution capacity twice |
| A05 | Unknown-scope personal inflow100 has no custody/2390 posting and blocks clean coverage; proven business unknown-payer100 may DrC/Cr2390. Unresolved owner-funding election remains visible and blocks affected clean close; unrelated personal rows never enter ledger |
| A06 | En Route reschedule closes one actual leg, retains mileage/custody, confirms replacement and clears field occupancy atomically; reject missing confirmation, started labor or stale conflicts. Cancellation remains available. Split accepted gross/discount/final values sum exactly, frozen consumption survives amendment; zero-price scope cannot duplicate |
| A07 | Roundtrip export includes supplemental openings/removed ranges, contribution conversions/returns, unknown-scope evidence, authority and reconstruction provenance; reconstruct exact remaining capacities and controls. Retained backup restores these with task/session invalidation and complete original objects |
| A08 | Drop-Off is enabled with configured custody checks; Pickup + Return is gated. Missing actual cutover/openings cannot bypass D12 by selecting no migration. Resource failure never purchases an upgraded instance automatically |

| A09 | Failed refund100 returned net95 with embedded fee5 restores F100 and same root ranges100, fee5 once. Retry100 clears F, never another revenue reduction. Separate credit100/debit5 evidence gives the same controls without duplicate fee |
| A10 | Enforce permitted semantic dimensions for legacy/opening concessions, tax remittance/recovery, purchase tax and asset gain/loss; reject generic tax/revenue line. Revoke-all changes actor security epoch; previously issued app sessions fail every next protected request, including pooled connections |

## 9. Google Calendar acceptance trace

P20/BR21/ADR35 require all GC01-GC18 in planning/GOOGLE_CALENDAR_V1.md, including deterministic fault injection and actual PostgreSQL permissions/atomicity plus distinct actual Google synthetic staging and real-phone tests. These are planned requirements, not passing tests or a universal bug-free guarantee. Ordinary public CI must never gain Google/production secrets; separate authenticated provider acceptance needs owner-approved setup and explicit evidence. A chat Calendar connector cannot substitute for Crest OAuth/runtime integration.

Merge gates for implementation include unit/type/lint/build, affected migrations/grants/DB/outbox concurrency, OAuth/protocol failure regressions and browser/a11y; deployment/first activation also require actual provider and real-device visibility, free quota/client-mode checks, disconnect/revocation, secret-free roundtrip exports and isolated restore/remote reconciliation. No skipped/mocked provider gate counts as real Google success. All existing M/D/N/R/accounting/security/recovery gates remain. Known defects block release; residual provider outages/refresh delays must be surfaced honestly.
