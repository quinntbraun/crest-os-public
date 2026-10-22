# Crest OS - Canonical Adoption and Adversarial Review

Version: 1.5 | 2026-10-22 | Owner-requested V1 Calendar contract; implementation and production gated

Calendar scope amendment, 2026-10-22: the owner requested Google Calendar connection support in V1. P20/BR21/ADR35 now require the capability with optional owner activation, outbound-only projection and unchanged integrity/security/recovery gates. This supersedes older optional/excluded Calendar wording only. Current versions and immutable-baseline amendment evidence are in CANONICAL_MAINTENANCE.md; implementation/research and unexecuted provider gates are in [the Calendar contract](../planning/GOOGLE_CALENDAR_V1.md). No live integration or production approval is implied.

Public edition, 2026-10-20: owner-authorized public source; application access and business evidence remain private. PUBLICATION.md records this explicit privacy/provenance amendment and the current authority/version register. Earlier private-repository and budget/authorization statements below are historical where superseded there. No security, accounting, recovery or real-data activation gate is waived.

Counterfactual: two successful operating years followed by a serious failure

## Scope and evidence limits

Reviewed CREST_CONTEXT and all eleven canonical source documents, including ACCOUNTING1.2 sections22/24/25 and the later project-local owner amendments. This canonical review accompanies PRODUCT/BUSINESS_RULES1.2, ACCOUNTING1.4 and technical companions1.3. Original inputs remain untouched; corrected outputs adopt X01-X28 and the section26 owner-custody contract. This is adversarial design self-review, not independent CPA, security or third-party certification. No application, migration, penetration test or restore test was executed.

Severity: Critical = permanent sensitive-data/history loss, substantial exposure or materially wrong financial truth; High = major incorrect workflow/recoverability; Medium = operational/cost/maintainability harm. Likelihood is estimated over two years *before the stated correction*: High plausible routine failure, Medium credible trigger, Low unusual but material. These are qualitative judgments, not measured probabilities. "Change now" means incorporated in this package; future tests remain mandatory.

## Failure register

| ID | Plausible failure scenario | Enabling decision/gap | Severity / likelihood | Change now? Resolution and residual risk |
|---|---|---|---|---|
| R01 | Customer delete cascades through jobs or identity deletion erases audit actors | Generic CRUD/cascading relationships not explicitly prohibited | Critical/Medium | Yes: DATABASE global RESTRICT, durable actors, archive directory only, immutable source guards; privileged admin remains controlled exception |
| R02 | Two-year-old monthly dump references photos removed by current storage lifecycle | DB retention specified without object retention dependencies | Critical/High | Yes: EXPORTS_AND_BACKUPS manifests pin original versions through expiry; extend lock or new retained copy; no business-original auto-GC |
| R03 | Phone uploads receipt, then reused upload URL changes same key after validation | Signed PUT to final immutable identity | Critical/Medium | Yes: SECURITY staging-only tickets and fenced copy-to-new-original verification; no final overwrite route |
| R04 | Device evicts unsaved camera capture; UI said work saved and owner assumes photos safe | Treat job completion/upload state as one success | High/High | Yes: distinct Pending/Available/backup evidence, original gallery advice and persistent retry state; unuploaded bytes cannot be guaranteed by PWA |
| R05 | Books balance while receipt was posted to wrong customer/account or twice as income | Balance check without source semantics/dimensions | Critical/High | Yes: DATABASE typed event/components/control restrictions, TESTING semantic assertions and daily reconciliation; ACCOUNTING1.4 supplies exact templates and independent source/control ancestry checks |
| R06 | Owner records same Venmo receipt on desktop after phone timeout using new key | Operation ID treated as complete deduplication | High/High | Yes: provider/account/reference uniqueness; match imports first; manual duplicates reviewed; true ambiguous cash requires owner evidence |
| R07 | Completion of second visit invoices whole accepted bundle again | No independent commercial entitlement consumption | High/Medium | Yes: stable entitlement, scope partitions and billing consumption; credit does not recreate unbilled work; T05/T06 |
| R08 | New service text/address/template changes what an accepted quote appears to say | History renders from current directory/template | High/High | Yes: exact customer-safe representation/hash/version/assets and historical snapshots; schema hash migrations require preservation tests |
| R09 | Phone accepts revision while desktop withdraws it; both show success | Separate send/accept transactions without same lock | High/Medium | Yes: family lock, active pointer and initial acceptance uniqueness; wrong version rejects before side effects |
| R10 | Phone starts job while desktop starts travel; separate unique indexes each allow one | Labor and travel exclusivity modeled separately | High/Medium | Yes: shared operator occupancy exclusion plus session guard; historical corrections also tested |
| R11 | Credit and refund each consume same refundable tip/excess concurrently | Per-document check reads stale aggregate | High/Medium | Yes: one finance serialization root, component lineage/remaining constraints, atomic unapply+credit; T17/T34/T36 |
| R12 | Migration succeeds on empty test DB but rewrites posted amounts or blocks production | Testing only new install; destructive rollback | Critical/Medium | Yes: upgrade populated prior releases, source hash/control checks, lock-time bounds, expand/contract, schema compatibility gate |
| R13 | Backup is encrypted and intact but owner lost key or provider console access | Keys/runbook only in failed hosting account | Critical/Medium | Yes: offline emergency kit, dual secure key copies, old-key retention and account-loss restore drill; owner must maintain custody |
| R14 | Backup reports success while one receipt is missing or snapshot spans inconsistent tables | Separate inventory read and unverified file copy | Critical/High | Yes: pg_dump+inventory same MVCC snapshot, verified originals, publish complete manifest last; missing object hard failure |
| R15 | Root hosting compromise deletes production and recovery copies | Same account/master credentials for everything | Critical/Medium | Yes: separate vault account, compliance lock, restricted writer, independent keys/monitor; simultaneous independent account takeover still residual |
| R16 | Last backup age exceeds24h while app dashboard is down or not opened | Backup monitoring only inside app | Critical/Medium | Yes: external completed-backup heartbeat,8/12/24h escalation, documented safety response and RPO breach; no infinite-outage guarantee |
| R17 | Stolen still-valid JWT keeps accessing private data after logout | Provider JWT refresh semantics assumed instantaneous revoke | Critical/Medium | Yes: app-session/epoch check every request plus provider session check, no browser DB API; in-flight bytes cannot be recalled |
| R18 | An authenticated new provider user becomes owner; SQL routine bypasses RLS | Email/first-login authorization, broad function grants | Critical/Medium | Yes: provisioned immutable subject membership, no registration, forced RLS/nonowner roles, fixed search_path/restricted EXECUTE and grant tests |
| R19 | Private customer PDF shows to another device/account through cache or leaked URL | Shared SSR cache or reusable signed GET returned to browser | Critical/Medium | Yes: no-store/static-only SW, protected download proxy, parent auth each request, tokens/log redaction; screenshots remain outside control |
| R20 | Quote link leaks via analytics/referrer or email scanner accepts offer | Public bearer URL with external assets or GET mutation | High/Medium | Yes: feature deferred; if adopted narrow hashed revocable token, no-referrer, no third parties, deliberate POST, honest possession evidence |
| R21 | CSV export rounds IDs, executes customer formula, or omits old versions/files | "Export" interpreted as visible table download | Critical/Medium | Yes: complete schema/links/escape dictionary, exact cents/IDs, consistent snapshot, original bytes and neutral reimport gate |
| R22 | Provider outage leaves portable CSV but no auth/bootstrap/schema tooling to run elsewhere | Auth/provider roles embedded in business identity; source only on GitHub | High/Medium | Yes: durable actors, adapter boundary, neutral PG restore/reprovision path, independent image/source/tool/config recovery copies |
| R23 | Photo download proxy/long exports/retained dumps drive costs above nominal storage budget | R2 free egress mistaken for free end-to-end delivery; undersized Node memory | Medium/High | Yes: usage model includes proxy bandwidth/restore allowance, quotas/alerts, streaming and tested upgrade; cost estimate remains bounded planning, not fixed quote |
| R24 | Complex architecture becomes impossible for one owner to maintain | Edge adapter, multiple queues/services or premature roles | High/Medium | Yes: standard Node, one image/modular monolith, DB queue/locks, no Redis/realtime/AI/public-link build; session layer retained only for explicit security requirement |
| R25 | Employee addition requires rewriting every history row and disables simultaneous work | Global owner singleton conflates tenant/user/operator | High/Medium | Yes: durable actors/memberships/capabilities and per-operator occupancy; V1 owner-only role; future employee policy still a separate scope/design |
| R26 | App restore reuses invoice numbers already given to clients after restore point | Restore resets sequence without external reconciliation | High/Medium | Yes: recover later evidence/reserve numbers, reconcile all post-point money before reopen; disclose irrecoverable gap |
| R27 | Administrative manual journal creates balanced control balance without invoice/funds record | Unrestricted manual adjustment to AR/customer funds | Critical/Medium | Yes: typed subledger adjustment required for control accounts; daily source-to-control check and gate on mismatch |
| R28 | Owner accidentally archives a receipt and exports omit it; audit lacks original | Archive interpreted as erase/exclude | High/High | Yes: history-inclusive exports/backups and protected evidence, logical archive only; destruction requires adopted retention process |
| R29 | Long export resumes with new live rows, making workbook disagree with ledger | Chunking by timestamps across independent reads | High/Medium | Yes: one snapshot/captured dataset, restart whole generation on interruption; manifest and PDF/XLSX use same data |
| R30 | Refund, custody return and payment all trigger duplicate review asks | Business trigger conflated with lifecycle statuses | Medium/High | Yes: completion-only atomic primary review request, explicit encounter duplicate warning; additional ask deliberate |

## Explicit specification reconciliation

P01-P19 acceptance bullets are mapped to layers, fixtures and evidence in TESTING.md section2. T01-T36 each have a dedicated test row in section3. The following checks cover the remaining normative sections and gates rather than assuming that those IDs alone are sufficient.

| Contract | Coverage decision and implementation obligation | Design disposition |
|---|---|---|
| PRODUCT1 authority/labels | Same source precedence; technical baseline adoption explicit, real policy approval not inferred; optional/future not promoted | Covered |
| PRODUCT2 purpose/boundaries | Single business/USD/owner; responsive installable web; required full ledger, three modes, exports/recovery/imports | Covered; no scope cut |
| PRODUCT2.2 optional | Public links/maps/Calendar/intake/AI/OCR/recurrence/assets deferred with boundaries | Covered; absence permitted |
| PRODUCT2.3 future | No employee UI/native app/bank feed/cards/deposits/subscriptions/payroll/tax filing/full ZIP | Covered |
| P01 | Live auth/session, versioned configuration and financial gate | SECURITY2/3, DATABASE2; tested before release |
| P02 | Minimal intake, source/lost reasons, due followups, no merge | DATABASE3/6 |
| P03 | Atomic selected conversion, Won only acceptance, historical ownership/photos/archive | DATABASE3/4 |
| P04 | Custom reviewed scope/prices/discounts/travel, private internal data, no unsafe promises | DATABASE4; quote projection and scope checks |
| P05 | Exact revisions, supersede race, accepted amendment and no partial acceptance shortcut | ARCHITECTURE5, DATABASE4 |
| P06 | Accepted allocations, exact location/contact, travel conflict+override, reschedule/cancel evidence | DATABASE5; no blanket exclusion preventing legal override |
| P07 | Mobile trip/arrival, active/pause continuity/corrections, manual ETA/miles, manual SMS evidence | ARCHITECTURE6/7, DATABASE5/6 |
| P08 | Drop-Off enabled and Pickup + Return disabled, both built, custody per vehicle, correct driven vehicle, return queue | DATABASE5 and ROADMAP7 |
| P09 | Job/vehicle photo context, actual upload state, atomic completion/review task, independent payment | DATABASE5/6 and SECURITY5 |
| P10 | One primary review, duplicate warnings, manual cadence/optout/rebooking | DATABASE6 |
| P11 | Immutable invoices, partial/split/tip/excess, verified receipts/clearing account, balance cap | DATABASE7; ACCOUNTING1.4 semantics adopted; real configurations gated |
| P12 | Credits vs cash refunds vs failed receipts; transfer/reconciliation provenance | DATABASE7; T14-T19/T34/T36 |
| P13 | Reviewed expenses/splits, duplicate receipts, owner funding, corrections, assets held unresolved | DATABASE7; OCR excluded |
| P14 | Physical leg once, source/actual/estimate precision, no automatic deduction | DATABASE5 |
| P15 | Accrual operational convention, posted immutability, balanced+semantic controls, periods/openings | DATABASE7; D01-D03 remain |
| P16 | All BR14 metrics, date cohorts/coverage, drillthrough and missing-data qualifiers | ARCHITECTURE4, TESTING P16 and BR14 below |
| P17 | Staged imports, repeated IDs, reference mode, full formats/files and tested recovery | DATABASE8, EXPORTS_AND_BACKUPS |
| P18 | 360px/44px, keyboard/screen reader, field interruption and uncertain finance | TESTING5 real-device gate; no unsupported offline guarantee |
| P19 | Desktop parity,3sec p95 progress/outcome, declared capacity | TESTING5; sizing gate, not unmeasured claim |
| PRODUCT5 D01 | Tax applicability/inclusive treatment verified before posting | Enforced unresolved profile gate; owner/adviser outstanding |
| D02 | Chart/mappings/openings/cutover completeness | Schema/controls ready; owner/accountant approval outstanding |
| D03 | Tax election/assets | No autonomous policy; unresolved classifications remain review |
| D04 | Cancellation fee | No fee autoactivation; ordinary cancellation usable |
| D05 | Nonmobile enablement/acknowledgements | Build tested, owner explicit real-world enablement |
| D06 | Catalog names/prices | Owner editable/versioned, historical examples no defaults |
| D07 | Travel formula/origin | Manual supported; no computed dollar recommendation |
| D08 | Cadence/winter/membership | Manual followups; no guaranteed cadence/contract |
| D09 | SMS/card/AI providers | Manual required workflows; optional external sharing gated |
| D10 | Backup infrastructure/funding/drill | Technical design selected; funding and actual evidence outstanding |
| D11 | Auth/limits/privacy retention | Technical settings defined; tested recovery/revoke and retention policy approval outstanding |
| D12 | Historical migration/cutover | Reviewed per-balance strategy, dedupe and openings, no double history |
| PRODUCT6/8 prior reviews | Preserved corrections including work/payment/custody separation and metric caveats | No regressions identified in design |
| PRODUCT7 release gates | Full P/T/type/lint/build/security/migration/finance/export/restore/pilot gates | ROADMAP13-16; no test pass claimed |
| BR00.1 relationships | Stable UUIDs, tenant FKs, durable actors, snapshots and dates | DATABASE1-8 |
| BR00.2 atomicity | Operation+business uniqueness, source-ledger atomicity, completion outbox | ARCHITECTURE5, R06/R07/R11 |
| BR00.3 precision | bigint cents/string API, decimal percentages/round-half-up, seconds, numeric miles | DATABASE1; TESTING T20/T21 |
| BR01 | Server/data ownership, scoped files, provisioned owner, explicit session settings | SECURITY; exact next-request revocation defined |
| BR02.1 minimal fields | Labels enough; unknown contacts/location retained; schedule validates later | DATABASE3/5 |
| BR02.2 lead machine | Nonterminal moves, Lost reason/reopen, accepted Won, conversion not Won | DATABASE3/4; lead_events |
| BR03 | Five categories/four conditions, Extreme manual ack, versioned services, no duplicate scope | DATABASE4 and TESTING P04 |
| BR04.1 | Quantity1 line model, <=one line+one document discount, largest remainder, complimentary reason | DATABASE4 numeric checks and T21; no float |
| BR04.2 | One-way>35 prompt, discretionary/embedded/waived, no multi-vehicle travel multiplier | Quoting service under ARCHITECTURE4/6; D07 |
| BR05 | State graph, approval/hash, actual sent, expiry/supersede, exact acceptance/amendment chain | DATABASE4 and serialized commands |
| BR06 | Partitions/consumption, credits don't rebill, scheduling confirmation and active-work reschedule semantics | DATABASE4/5/7; explicit remaining-visit allocation |
| BR07 | Exact work transitions, partial outcome, no reopen, one field session, active/travel nonoverlap | DATABASE5; corrections historical not overwrite |
| BR08 | Mobile/Drop-Off enabled; Pickup + Return disabled; separate per-vehicle custody, acknowledgements/return evidence | DATABASE5; release not implicit |
| BR09 | Physical mileage provenance, estimates separate, fractional job attribution, ETA edits/manual fallback | DATABASE5; no mileage accounting |
| BR10 | Prepared/opened/confirmed sent evidence, optout, completion-only review, manual maintenance | DATABASE6; no satisfaction filtering |
| BR11.1 | Immutable numbered issue, completed authorized scope, balance after credits/allocations | DATABASE7; due-date default issue date, no late fee belongs domain validation |
| BR11.2 | Recorded receipts only, sum splits, confirmed tips, excess funds and clearing accounts | DATABASE7; no inferred bank movement |
| BR11.3 | Refund components, unapply+credit, remaining limits, failed payment preserves earned revenue | DATABASE7; finance lock and correction lineage |
| BR12.1 | Operational accrual, chart types, event uniqueness, immutable journals, openings detail | DATABASE7; ACCOUNTING1.4 final templates adopted |
| BR12.2 | Explicit single-inclusive policy, original rate credits, exact final remainder | Tax profile versions and original component snapshots; D01 not replaced |
| BR12.3 | Exact specialized posting templates adopted; no self-selected real tax/equity policy | Typed events; TESTING semantic fixtures; ACCOUNTING1.4 owns specialized final specifications |
| BR12.4 | Nonposting statements, split/combine match sums, zero difference, period lock/unlock invalidation | DATABASE7/8; manual plug prohibited |
| BR13 | Expense/gross/split checks, safe receipts/originals, typed photo links, no evidence purge | DATABASE6/7 and SECURITY5/7 |
| BR14 | Revenue/tips/discounts/returns, cash, net income/margin, AR/aging, scheduled value, completed/average ticket, cohort/source/area, repeat/new/lead close, cancellation/completion, time/contribution/hour/miles all preserve stated basis and unknowns | Versioned report query contract is BR14 verbatim normative; TESTING P16 asserts each definition/denominator; no new metric formula |
| BR15.1 | Row/batch identities, approved mapping, dependency atomicity, reference vs financial import | DATABASE8; no silent fingerprint merge |
| BR15.2 | Every implemented entity/audit/config export, safe exact text, typed workbook/PDF, original bytes | EXPORTS_AND_BACKUPS2/3; neutral reimport |
| BR16 | Private-by-default, env separation, append audit, migration discipline, optional AI gated | SECURITY and ROADMAP |
| BR17 |24h objectives,30daily/12monthly, isolated copy/key/config/files, monitor/drill/authorized restore | EXPORTS_AND_BACKUPS4-8; objective evidence pending |
| BR18 T01-T36 | Every fixture mapped individually, with persisted assertions | TESTING3 |
| BR19 residual decisions | D01-D12 remain explicit, no historic rates/fees/cadences promoted | ARCHITECTURE_DECISIONS |

## Product/rules corrections adopted

Operation IDs alone cannot deduplicate new-key receipts; unified external envelopes, review of ambiguous duplicates and descendant capacities now live in BR11/DATABASE7. RPO/RTO are measured objectives; six-hour cadence/retention, independent alerts and owner-approved continuation during backup-age breach remain unchanged. Actual recovery pauses writes and rotates finance authority; this is distinct from a stale-backup warning. Drop-Off remains enabled, Pickup + Return separately gated; contact-only Urable migration and prospective books remain approved scope.

Accounting X01-X28 are incorporated directly, not left for engineering. R05/R27 now require typed sources, controls and ancestry; R06 requires cross-type economic envelope/fee identity; R07 requires atomic replacement consumption or reservation; R11 requires original ranges, funding descendants, opening and legacy origins and inbound/outbound-failure distinction; R26 requires recovery epoch and full number reservations/series. ACCOUNTING24's F01-F12 and R01-R12 are required regressions, not test-pass claims.

Additional risk R31: treating personal wallet wealth as Crest cash or every receipt as owner contribution materially misstates books. ACCOUNTING26/DATABASE7.6 use only business custody, explicit personal financing and settlements, no full personal balances, no automatic drawings/loans and distinct reconciliation. Residual risk: owner omissions and misclassification cannot be disproved by balanced journals. Evidence review, supported openings, per-channel controls and visible incompleteness remain essential.

## Disposition

Canonical baseline is ready for GitHub repository creation and nonfinancial/synthetic financial implementation. This task does not initialize the repository or implement software. No supported foundational accounting behavior is deferred to Codex: exact roots, ranges, item abstractions, owner custody, fees, dates, control structures, reporting and recovery are specified. Unsupported exceptional economic cases require explicit policy amendment.

Real financial activation remains blocked by D01 verified applicable tax profiles, D02 actual channels/mappings/custody/opening evidence, D12 exact cutover/coverage, applicable D03 cost/asset policies, implemented accounting/security/database/export tests, D10/D11 tested recovery/keys/alerts/capacity/auth and reconciled pilot. Required nonfinancial behavior is preserved. Actual prices/cadences/terms remain owner configuration rather than invented defaults.

## Owner-directed review update - 2026-10-20

This amendment supersedes the earlier paid baseline and statement that product/rules remain unchanged. PRODUCT and BUSINESS_RULES revised candidates now record enabled Drop-Off, prospective accounting/contact-only import, duplicate-review semantics, the approximately $10 target and continued financial writes during backup failure. D10/D11 have owner direction but still require operational evidence. Additional residual risks: Free DB pause/quota exhaustion (High/Medium; quota/availability alerts and tested resume/restore); excessive backup egress/cron runtime (Medium/Medium; meter before launch); reused email password defeating recovery independence (Critical/Medium; unique credentials, MFA and offline kit); loss of unbacked writes during an extended backup outage (Critical/Medium conditional on outage; owner explicitly chooses continued entry and persistent alerts). No production test is claimed. Accounting technical design is adopted; exact real cutover/openings and tax-profile evidence remain activation inputs. Domain ownership and actual free-tier resource fit remain provisioning questions.


## Final workflow decision audit

| Workflow | Deterministic boundary / result |
|---|---|
| Lead → customer → vehicle | Explicit duplicate selection, atomic conversion, historical associations retained (BR02/DATABASE3) |
| Quote → acceptance → schedule | Exact approved sent revision, serialized acceptance/amendment, scope partitions and confirmed schedule (BR04-BR06) |
| Job → invoice → receipt → accounting → review | Completion creates immediate review independently of payment; invoice explicit and fulfilled; typed receipt/root/custody settles AR once (BR07/BR10/ACCOUNTING4-7/26) |
| Expense → receipt → accounting → reconciliation | Receipt is evidence, dates/funding separate, cost-origin ledger and channel-specific matching (ACCOUNTING8/10/26) |
| Funds → application → refund/tip | Same-customer root descendants, explicit intent, exact remaining capacity (ACCOUNTING4.3/7/24.3) |
| Credit → unapplication → refund | Minimum unapplication and credit atomic; refund separate confirmed outflow; exact original ranges (ACCOUNTING5/7) |
| Payment failure | Actual debit channel, surviving descendant AR/funds/tips, excess debit reviewed suspense; outgoing failure instead restores liability (ACCOUNTING4.4/24.3/26) |
| Transfer → transit → arrival/fee | Actual legs/dates and partial capacity; evidence-only fee, no sale (ACCOUNTING6) |
| Cutover → openings → prospective books | Exact boundary and opening-before-ordinary order; verified/zero/unknown states; legacy evidence nonposting (ACCOUNTING12/24.6) |
| Backup → restore → later activity → resume | Independent complete snapshot, authority epoch rotation, later-evidence/number reconstruction and full controls before clean financial resume (EXPORTS_AND_BACKUPS7) |

Remaining real-world uncertainty is an explicit activation or per-event policy gate, not a permission for implementation to choose behavior. This decision audit is specification review only; implementation must prove these results with required tests.


## Independent pre-code challenge pass - 2026-10-20

Fresh adversarial review found substantive defects in the previously adopted baseline; its earlier readiness narrative was not evidence against these findings. This remains a separate review pass by the same assistant, not independent professional certification.

| Finding | Corrected binding contract |
|---|---|
| Recovery epoch check could precede transaction lock; operational retries/workers/former authority could survive restore | ARCHITECTURE5 shared authority fence, exclusive incident rotation, old writer fencing; DATABASE2 and SECURITY8; TESTING A01 |
| Ordinary issue commands cannot faithfully reconstruct proven lost issued dates/numbers and snapshots | EXPORTS_AND_BACKUPS7.2, DATABASE7.7: restricted reconstruction and original/new provenance; TESTING A02 |
| Opening deltas lacked exact immutable-root capacity mechanics | ACCOUNTING12.3, DATABASE7.3-4: supplemental roots/items and removed-range terminal/restoration; TESTING A03 |
| Owner funding correction/capital return cap lacked a typed cross-event capacity registry | ACCOUNTING26.3a, DATABASE7.6: contribution lots, obligation conversion and exact bounds; TESTING A04 |
| Unknown ownership of a personal inflow could become fictitious business custody; pending funding could escape close coverage | ACCOUNTING26.3a nonposting unknown queue and clean-close block; DATABASE7.6; TESTING A05 |
| En Route rescheduling lacked its transition; gross/discount scope partitions were absent from schema catalog | BR07, DATABASE4; TESTING A06 |
| Roadmap could gate already-enabled Drop-Off, skip D12 without migration, require finance tests before finance; TESTING could auto-upgrade hosting | ROADMAP2/5/7/8/15 and TESTING5/A08 corrected |

X01-X28 remain adopted and applicable. These findings close additional mechanics within those contracts, particularly X03/X06/X12/X16/X17/X23. No accounting semantics are deferred to an engineering choice. All added lineage/recovery structures are explicitly included in exports and restore checks. PASS for repository creation and synthetic/nonfinancial implementation means specification handoff readiness only; real financial use remains FAIL until actual activation evidence and implemented release/recovery tests pass. CREST_CONTEXT is unchanged. No code, migrations, repository or infrastructure were created.

Additional defects corrected: the generic journal-dimension rule wrongly restricted approved legacy/opening/tax/disposal sources to invoice/tip parents; DATABASE omitted explicit actor/session security-epoch fields; a net returned refund needed an explicit gross-liability/embedded-fee template. ACCOUNTING4.1/24.3, DATABASE2 and TESTING A09-A10 now specify them. PRODUCT D05/D12 gating wording was brought into agreement with the already approved operating modes and prospective cutover.

## 2026-10-22 Calendar amendment design review

The earlier optional/future scope disposition predates the owner's explicit P20 addition. ADR35 now selects opt-in one-way publication to a dedicated app-created calendar. Reviewed risks: OAuth scope/token leakage and account mix-up; duplicate external creation/lost acknowledgement; out-of-order reschedules and external edit/delete; Google outages/billing changes; stale workers/restore replay; misleading current-success state; and unnecessary client/financial disclosure. The narrowed payload/scopes, transaction outbox, retained IDs/attempts, etags/review, bounded budgets, recovery reconciliation and GC01-GC18 address these in the contract. They remain unimplemented/unexecuted and require adversarial implementation/provider tests. Review is by the implementing assistant, not independent security certification; no claim of bug-free code or free production infrastructure follows.
