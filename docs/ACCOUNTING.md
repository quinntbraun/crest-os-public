# Crest OS V1 - Accounting Contract

Version: 1.5 | 2026-10-20 | Canonical V1 baseline adopted for implementation; production activation gated


Public edition, 2026-10-20: owner-authorized public source; application access and business evidence remain private. PUBLICATION.md records this explicit privacy/provenance amendment and the current authority/version register. Earlier private-repository and budget/authorization statements below are historical where superseded there. No security, accounting, recovery or real-data activation gate is waived.

## Executive accounting architecture summary

Crest OS uses an immutable, source-driven, USD double-entry ledger. Completed authorized scope earns operational book revenue when an invoice is explicitly issued; collection settles that receivable. Unbilled completed work is an exception, not silently estimated revenue. Tips are separate revenue. Unidentified excess is a customer liability. Transfers and owner funding are not sales. Corrections append linked events rather than editing posted history.

This contract completes the accounting semantics deferred by ADR21 and ROADMAP phase 0. It defines the chart, mapping purposes, source templates, component lineage, openings, reconciliation, reports, errors and acceptance fixtures. It preserves the existing Node/PostgreSQL monolith, finance lock, integer cents, manual payment recording, prospective cutover, contact-only Urable migration and independent recovery controls. No new recurring service is required.

The principal review findings are structural: original receipt components alone cannot track money after unapplication/reallocation; opening receivables need collectable subledger identities without new sales; refunds of opening funds need an opening origin; transfers need separate departure/arrival dates; statement matching needs explicit outstanding items; corrections must retain original mappings; and credit rounding must consume exact original components. The final review additionally corrected reversed-credit rounding, purchase-versus-payment dates, control remapping, unknown-money resolution, legacy paid-item returns, correction/restoration semantics and recovery replay boundaries. Sections 3-13 and 24 resolve these explicitly. Sections 22 and 24.12 retain the X01-X28 provenance register; all amendments are incorporated into the canonical companions. Section 26 resolves the mixed-personal-account technical dependency.

Readiness: adopted canonical baseline, ready for repository creation and nonfinancial/synthetic financial implementation without choosing Indiana tax treatment or real opening amounts. Not ready for real financial activation. No repository, code, migration, UI, infrastructure, executed engine test, CPA certification or tax election is supplied.

## 0. Authority, evidence and reading guide

Reviewed inputs: read-only sources/Crest_Context.md and all eleven current local deliverables. Later project-local owner budget, security, recovery, Drop-Off and prospective-start amendments take precedence over earlier saved technical copies; ACCOUNTING1.2 already recorded that provenance. This reconciliation retains those current decisions. No GitHub repository was identified, initialized or changed. The canonical output is PRODUCT/BUSINESS_RULES1.2, ACCOUNTING1.4 and technical companions1.3, all dated2026-10-20; contextual CREST_CONTEXT is unchanged.

Precedence remains current repository documentation and explicit current decisions, latest explicit owner statements, consolidated context, historical examples and public copy. The adopted product/rules define scope and operations; this specialization defines accounting semantics, not unrelated security or product policy. True conflicts require an explicit documented amendment. The current request adopts the technical baseline; it does not approve unresolved tax/legal/actual-balance facts. Synced sources are read-only.

Normative words MUST/MUST NOT define implementation obligations. All account numbers, monthly close conventions and algorithms below are documented adopted technical design selections, not assertions about Crest's current books. D01/D02/D03/D12 remain real activation/evidence gates; section26 supplies the previously missing mixed-account implementation contract. Monetary examples are synthetic and independent unless explicitly continued. No actual opening value is asserted.

Navigation: §26 owner custody; §§1-3 model/chart/mappings; §4 exact posting matrix and shared template contract; §§5-12 workflow mechanics; §§13-18 reports/controls/errors/audit/handoff; §19 synthetic journals; §20 adversarial review; §21 decisions/readiness; §22 cross-document corrections; §23 initial verification; §24 final corrected contracts, companion amendments and regression fixtures.

External verification was limited to general recordkeeping principles: IRS Publication 583, https://www.irs.gov/publications/p583, and IRS "How should I record my business transactions?", https://www.irs.gov/businesses/small-businesses-self-employed/how-should-i-record-my-business-transactions, accessed 2026-10-20. These support keeping source evidence with journals/ledgers and separating tax-method selection from bookkeeping design. They do not establish Crest's entity tax status, Indiana taxability, retention period or elections. All implementation algorithms below are Crest design decisions, not claims that the IRS prescribes this software architecture.

## 1. Accounting model and scope

### 1.1 Bookkeeping policy versus tax policy

**BOOKKEEPING POLICY:** follow BR12.1 operational accrual-style recognition. Issue invoices only against fulfilled, accepted scope; debit AR and credit earned service/tax components. Recognize reviewed consumed supplies and other expenses when incurred; unpaid obligations use the minimal payable subledger. Record asset/prepaid classifications only when reviewed. Receipt dates drive money movements, not a second service sale. No estimated owner labor expense, automatic mileage expense, unbilled accrual, depreciation schedule, bad-debt write-off or inventory valuation engine.

**TAX POLICY / TAX ELECTION:** filing method, LLC tax classification, deductibility, tax rates/applicability, capitalization, depreciation and tax-year elections are outside this contract. Operational book data and cash evidence are handed to an adviser for adjustments. Calendar reporting and book equity display do not elect a tax year. Unknown tax is never zero tax. Synthetic profiles are barred in production.

Required V1 includes paid purchases and minimal unpaid supplier obligations, because ROADMAP phase 10 and BR12.3 already allow payable settlement. An asset register UI remains optional; a typed asset schedule is mandatory if asset-control postings are activated. No accounts-payable procurement suite, payroll, card processing, direct provider refunds, historical ledger migration, automated tax filing or formal cash-flow statement is added.

### 1.2 Dates and state

| Field | Meaning and rule |
|---|---|
| economic_at / economic_date | Actual service, receipt, concession, expense or movement occurrence; owner evidence, never silently shifted |
| effective_date | Immutable local accounting date controlling ledger inclusion; normally economic_date, subject to invoice recognition and locked-period rules below |
| issued_at / issued_date | Actual invoice issuance, separate from service completion and ledger date; never pretend a late invoice was sent earlier |
| recorded_at | Server UTC instant source/evidence was recorded |
| posting_at | Server UTC instant journal was committed; not a user-editable accounting date |
| timezone | Snapshot America/Indiana/Indianapolis initially; explicit IANA zone; UTC instants do not move when settings change |
| statement_date | Provider's settled movement date; may differ from receipt/transfer recognition date |

Normal invoice effective_date equals issued_date; proven lost issued records use the restricted reconstruction contract in EXPORTS_AND_BACKUPS7.2 with separate new recording provenance; completion may precede it. V1 does not backdate revenue automatically to completion. Open-period correction may use original effective_date only with explicit reason/evidence. Locked-period correction uses an owner-selected open date and retains original economic date/prior-period reference. Future economic postings are rejected; future plans remain drafts. Backdating cannot predate cutover or any prerequisite source unless it is an approved opening correction. All multi-step atomic correction entries share one effective_date, not a temporarily negative subledger at an intermediate report date.

Sources progress Draft/Needs Review/Pending to Posted/Recorded/Issued as appropriate. Posted payload is immutable. Reversed is a projection from linked events, not permission to mutate it. Zero-effect source events require a whitelisted reason, no zero journal lines. A 100% discount is not automatically zero-effect: gross and discount may offset (§5).

### 1.3 Event, journal and subledger contract

One financial event has one typed source and immutable component rows. A command may create several dependent events and journals atomically. Each event has a unique source identity independent of retry operation ID. Journal entry identity is event plus sequence; at least two nonzero one-sided lines; debit sum equals credit sum in integer cents. Posting templates are versioned allowlists, not client-selected debit/credit arrays.

Subledgers: receivable items; receipt funding origins and descendants; customer fund lots; cash/payment account movements; payable items; transfer transit lots; tax movements by original profile; optional fixed-asset cost/depreciation schedules; explained suspense items. Their balances derive from immutable movements. Cached projections are disposable and must reconcile to journal controls. A running total column cannot be a second financial truth.

Business finance-control locking applies to every posting, allocation, correction, mapping change, reconciliation approval and period lock. Use ARCHITECTURE §5's exact transaction and global lock order. Source, journal, lineage, audit, operation result, sequence reservation and invalidation events commit together. No external network call under those locks. All dates and same-business/customer constraints are checked again at this boundary.

## 2. Adopted chart of accounts (actual account activation gated)

Normal balance D=debit, C=credit. "Control" means journal lines require typed supporting movement/detail, including manual and opening commands. "Manual R" permits a reviewed non-control adjustment only with purpose, evidence and counterpart validation; "No" forbids generic direct entry. Archive "A" means new ordinary use can be disabled once mappings/open obligations are moved or resolved; historical entries and exact reversals remain readable/postable. Never delete used accounts, reuse codes, change used type/control role or hide archived balances. Conditional accounts are inactive until the stated use is verified. No balance is seeded.

| Code | Name | Type / normal | Purpose and control | Manual | Archive | Source events / activation |
|---|---|---|---|---|---|---|
| 1000 | Business checking | Asset D | Reconciled bank movements; control | No | A | Receipts, expenses, transfers, equity, refunds, openings; one account per actual bank account |
| 1010 | Cash on hand | Asset D | Physical cash inventory; control | No | A | Cash receipts/outflows/deposits/count adjustments |
| 1020 | Undeposited checks | Asset D | Check-by-check custody; control | No | A | Check receipt, deposit dispatch, dishonor |
| 1030 | Venmo balance | Asset D | Actual Venmo business money; control | No | A | Receipts, refunds, fees, transfers, opening |
| 1040 | Cash App balance | Asset D | Actual Cash App business money; control | No | A | Same as 1030 |
| 1050 | PayPal balance | Asset D | Actual PayPal business money; control | No | A | Same as 1030 |
| 1060 | Transfers in transit | Asset D | Identified unsettled transfer/deposit lots; control | No | A | Dispatch/arrival/return only |
| 1070 family | Business funds held by owner - named channel | Asset D | Business-only custody lots; separate control for each mixed personal channel; not the whole personal balance or an owner loan | No | A | Section26 receipts, funding, expenses, refunds, fees, transfers and settlements |

| 1090 | Other verified money account | Asset D | Named external account, never miscellaneous income; control | No | A | Activate separately per real account |
| 1100 | Accounts receivable | Asset D | Invoice and opening receivable items; control | No | A | Issue, credit, apply/unapply, failure, opening |
| 1120 | Other documented receivables | Asset D | Identified supplier-refund/disposal receivable items; control | No | A | Conditional approved claim, settlement, correction; never service AR shortcut |
| 1150 | Prepaid business costs | Asset D | Reviewed future-benefit cost schedule; control | No | A | Conditional prepaid acquisition/release/correction |
| 1180 | Recoverable purchase tax | Asset D | Verified recoverable purchase-tax items; control | No | A | Conditional D01/adviser approval; no default recovery assumption |
| 1190 | Unresolved outflow clearing | Asset D | Explained actual outflows awaiting classification; control | No | A | Explicitly approved suspense only, incomplete-book warning |
| 1500 | Equipment at cost | Asset D | Asset-level historic book cost; control | No | A | Conditional asset/opening/capitalization/disposal |
| 1590 | Accumulated depreciation | Contra-asset C | Asset-level book depreciation; control | No | A | Conditional reviewed manual depreciation/disposal |
| 2000 | Customer funds held | Liability C | Customer funding-origin lots; control | No | A | Excess/advance, unapplication, apply, refund, reclass, opening |
| 2100 | Sales tax payable | Liability C | Profile/jurisdiction tax movements; control | No | A | Conditional invoice/tip/credit/remittance/opening |
| 2200 | Accounts payable | Liability C | Supplier bill balances; control | No | A | Unpaid incurred expense, settlement, supplier credit, opening |
| 2300 | Business debt principal | Liability C | Named debt/credit-account schedule; control | No | A | Conditional verified loan opening/draw/principal repayment |
| 2350 | Amounts due to owner | Liability C | Explicit reimbursement obligation; control | No | A | Conditional election on source, settlement/opening |
| 2390 | Unidentified incoming funds | Liability C | Unknown-payer receipt items; control | No | A | Evidence-only receipt until counterparty identified; no invented customer |
| 3000 | Opening equity | Equity C (may be D) | Documented net opening position | No | A | Approved cutover and linked opening correction only |
| 3100 | Owner contributions | Equity C | Actual contributed cash/business costs/assets | No | A | Typed owner funding, owner-paid expense |
| 3200 | Owner distributions | Contra-equity D | Personal withdrawals/business-funded personal portion | No | A | Typed draws, mixed purchase, owner reimbursement correction |
| 3300 | Prior equity adjustments | Equity C (may be D) | Adviser-directed historical equity adjustment; not annual automatic closing | R | A | Conditional reviewed equity adjustment with schedule |
| 4000 | Detailing service revenue | Revenue C | Gross net-of-tax earned detail/coating/correction amounts | No | A | Issued invoice; full correcting replacement links |
| 4100 | Tip revenue | Revenue C | Explicit owner-retained customer tips, net of tax | No | A | Receipt, funds-to-tip, tip refund/failure |
| 4200 | Other identified income | Revenue C | Specifically reviewed non-service income (e.g. bank interest) | R | A | Conditional typed income/adjustment, never unclassified deposits |
| 4300 | Gain on asset disposal | Revenue C | Disposal proceeds less carrying value when positive | No | A | Conditional disposal |
| 4900 | Service discounts | Contra-revenue D | Invoice gross-net discount; credit reversals credited here | No | A | Invoice, proportional credit, correction |
| 4910 | Service returns and concessions | Contra-revenue D | Gross-net service reductions before discount reversal | No | A | Credit/correcting credit |
| 5000 | Chemicals and consumable supplies | Expense D | Reviewed chemicals/towels/pads/consumables | R | A | Purchase, supplier refund, correction |
| 5100 | Fuel and business travel | Expense D | Reviewed actual business costs; not automatic mileage | R | A | Purchase/refund |
| 5110 | Vehicle operating and maintenance | Expense D | Business share of rig maintenance/operating costs | R | A | Purchase/refund |
| 5200 | Small tools and equipment expense | Expense D | Approved expensed tools; no default threshold | R | A | D03-classified purchase/refund |
| 5300 | Payment and bank fees | Expense D | Explicit actual fees, distinct from transferred principal | R | A | Fee, receipt/transfer fee, refund fee |
| 5400 | Software and communications | Expense D | Business subscriptions/communications | R | A | Purchase/refund/prepaid release |
| 5500 | Marketing | Expense D | Business promotion | R | A | Purchase/refund |
| 5600 | Insurance | Expense D | Reviewed period cost; prepaid portion separately | R | A | Purchase/prepaid release/refund |
| 5700 | Professional services | Expense D | Business accounting/legal/professional costs | R | A | Purchase/refund |
| 5800 | Training and certification | Expense D | Reviewed business training | R | A | Purchase/refund |
| 5900 | Workspace and storage | Expense D | Workspace/storage costs | R | A | Purchase/prepaid release/refund |
| 6000 | Equipment repairs and maintenance | Expense D | Repairs distinct from asset improvements | R | A | Purchase/refund, classification review |
| 6100 | Other identified business expense | Expense D | Named reason required; not an unknown-category dump | R | A | Reviewed purchase/adjustment |
| 6200 | Depreciation expense | Expense D | Approved book depreciation | No | A | Conditional manual depreciation |
| 6300 | Loss on asset disposal | Expense D | Negative disposal difference | No | A | Conditional disposal |
| 6400 | Interest expense | Expense D | Documented interest, separate from debt principal | R | A | Conditional debt payment/expense |

Contra-asset and contra-equity use existing DATABASE account type asset/equity plus credit/debit normal side and report-role metadata; no new accounting type enum is necessary. 3300 is not an automatic destination for current earnings. Derived accumulated earnings are shown separately (§13). Do not use one account for several wallets or mixed bank accounts. Zelle is a payment method, normally routed to its actual bank account; create a separate settlement account only if evidence establishes a distinct balance. Do not create a fictional Zelle wallet. Coatings/correction use service dimensions under 4000, avoiding extra revenue accounts at this scale.

## 3. Account mappings and versioning

| Mapping purpose | Allowed account / activation |
|---|---|
| service_revenue | 4000, revenue, not generic other income |
| tips_revenue | 4100, separate revenue |
| discount / returns | 4900 / 4910 contra-revenue |
| ar / customer_funds | 1100 / 2000 with matching control kinds |
| cash / checks / bank:<id> / wallet:<id> | 1010 / 1020 / distinct 1000-family / 1030-1050 or named 1090 |
| owner_custody:<channel_id> | Distinct1070-family asset with owner_custody control/report role, explicit owner and masked channel identity; business-only lots under section26 |

| transfer_transit | 1060, lot control |
| category:<approved_category> | Reviewed expense or asset account; unresolved does not map to "Other" |
| fee / owner_contribution / owner_draw / opening_equity | 5300 / 3100 / 3200 / 3000 |
| payable / due_owner / debt:<id> | 2200 / 2350 / 2300 schedule, only when used |
| tax_payable:<jurisdiction> / purchase_tax_recoverable | 2100 / 1180, conditional on verified treatment |
| fixed_asset / accumulated_depreciation / depreciation_expense | 1500 / 1590 / 6200, conditional |
| disposal_gain / disposal_loss / prepaid / suspense_outflow / unidentified_inflow | 4300 / 6300 / 1150 / 1190 / 2390, conditional typed uses |

Every posting snapshots mapping version, chosen account IDs, template version, tax versions and report classification roles. Configuration versions are append-only, approved, effective-dated and nonoverlapping per purpose/account scope. Resolve the version valid on effective_date, except corrections/credits that explicitly use original account/component snapshots. New active mappings cannot rewrite old entries. Exact reversal uses original accounts even when archived; ordinary postings to an archived account are rejected.

Before activation, validate account type, normal side, control kind, currency, distinct purposes and required mappings for that template. Missing/ambiguous mapping fails MAPPING_NOT_READY, never falls back. Prevent aliasing service revenue/tips or customer funds/tax controls to the same account. **V1 does not migrate used control accounts or remap an existing control purpose to a different account after first posting.** Account names may change with history; account IDs, control roles and used mappings remain stable. A future control-account migration needs its own adopted specification, including subsequent old-source corrections; it is not a generic manual adjustment. Opening and ordinary item sources pin their control-account IDs, and settlements/corrections use those pins. New distinct external bank/wallet accounts are permitted with verified ownership/openings; actual transfers move money between them. They cannot rename/repoint an old account to a different institution or alter historical transactions. D02 approves actual bank/wallet identities and account ownership. Capture masked identifiers only, never banking credentials.

## 4. Source-event posting specification

### 4.1 Shared template contract (mandatory for every matrix row)

Each template below inherits this section; its row supplies trigger/source/debits/credits/special guards. The implementation must not omit shared fields because a row is terse.

1. **Trigger/prerequisites:** explicit reviewed source transition, valid actor/business, USD, mapped active accounts, all required D-gates, open period, source evidence and dependency state. Pending events do not post. Finance lock and semantic validation precede all inserts.
2. **Source identity:** unique `(business, kind, source_uuid, transition/component_sequence)` plus operation ID/hash. Invoice issue is unique per invoice; origin receipt and transfer legs have stable IDs; original credit/refund/reversal identities are never reused. Provider identity is separate (§6). A retry returns original results, not a new posting date.
3. **Dates:** normal invoice issue date; receipt actual receipt date; credit approval/economic concession date; refund actual outgoing date; expense incurred date; settlement/transfer actual leg date; owner event date; opening cutover date; correction date per §11. Recorded/posting timestamps always server assigned. No action inferred from an uploaded statement alone.
4. **Dimensions:** business, event, source component, actor, policy/template/mapping IDs on all lines. AR requires customer and receivable-item ID; funds requires customer and lot/root origin; service revenue/discount/return requires its invoice item or typed opening/legacy charge component; tips require tip realization; other income/gain/loss requires its allowed typed income/disposal source. Sales-tax lines require the original taxable invoice/tip/disposal component or typed tax opening/remittance/recovery/approved-adjustment schedule, as applicable; purchase-tax lines require original cost/tax detail. A generic invoice-or-tip-only FK must not exclude these approved templates; money lines require account movement. Invoice components retain job, vehicle, service, agreement/allocation and source snapshots; split multi-job values into attributable child lines. Expenses use split/vendor/job attribution; transfers use transfer/leg IDs; equity uses owner; opening uses cutover/detail. Unknown dimension stays explicitly unallocated, never guessed.
5. **Tax/rounding:** only invoice/tip/credit rows calculate sales tax using §7; other movements carry original components or no sales-tax effect. Expense purchase tax uses §8. Integer cents; no rounding of sums; omit zero journal lines. Refunds/failures consume exact original proportions and terminal residuals. No current-rate re-evaluation.
6. **Correction:** append linked reversal/replacement or specific reclassification; never edit. Reverse dependent allocations first where necessary, within one transaction. No pretend cash reversal of a real movement. Original mappings/dimensions retained. §4.4 and §11 govern all corrections.
7. **Control:** every journal control effect equals same-event subledger movement; validate per customer/item/lot/account, not aggregate only. Amounts and original-component capacity rechecked under lock. Event is posted only if all expected journals and supporting rows exist; whitelisted zero event excepted.

Notation: M=actual business money account or section26 business-only owner-custody channel (personal funding shortfalls use its explicit split, not negative custody); AR=1100; F=2000; SR=4000; TR=4100; D=4900; R=4910; TX=2100; AP=2200; OC=3100; OD=3200. A=inclusive charge; G=pre-discount net service; N=post-discount net service; d=G−N; t=A−N. All symbols represent nonnegative cents. Matrices specify accounting effects, not code.

### 4.2 Posting-template matrix

| ID / trigger and typed source | Debit | Credit | Special prerequisites, links and control effect |
|---|---|---|---|
| P01 Invoice issue / invoice-items | AR A; D d | SR G; TX t | Completed unconsumed authorized scope, tax-ready, due date; each line G−d+t=A; AR item +A |
| P02 Complimentary invoice / invoice-items | D G if gross discounted | SR G if gross discounted | A=0; 100% discount uses P01 net tax=0; literal zero-price G=0 produces verified zero event; scope consumption still recorded |
| P03 Receipt recorded / payment-components | M total | AR applied; TR tip net; TX tip tax; F remainder | Owner confirms actual money; same customer; allocations capped; sum components=receipt; original funding origins created |
| P04 Funds application / fund-movements | F applied | AR applied | Explicit approval; issued invoice/opening item same customer; funds available; no revenue/tax change |
| P05 Payment unapplication / allocation-events | AR unapplied | F unapplied | Original live allocation; descendant lot inherits funding origin; no cash change; paired with credit when needed |
| P06 Funds converted to tip / tip realization | F inclusive tip | TR net; TX tax | Explicit customer intent and verified tip profile; cannot consume refunded/failed funds |
| P07 Service credit / credit-items | R credited gross-net; TX original credited tax | AR inclusive credit; D original discount reversed | Formula §7; unapply amount needed via P05 atomically; no cash; no new billable scope |
| P08 Service refund / refund-components | F service-credit funds | M confirmed outflow | Link credit item, released allocation, root receipt/opening provenance; no second revenue/tax reduction |
| P09 Excess return / refund-components | F excess | M confirmed outflow | Original excess lot/remaining root; no service/tip/tax effect |
| P10 Tip return / refund-components | TR original tip net; TX original tip tax | M inclusive returned tip | Consumes original or reclassified tip realization; no invoice credit |
| P11 Failed/erroneous collection / reversal-components | AR active applications; F unspent funds; TR remaining realized tip net; TX its tax | M actual failure/erroneous money amount | Only surviving components; revenue SR unchanged; §4.4 distinguishes original-error account and actual later debit account |
| P12 Same-date paid purchase / expense-splits | Reviewed expense/asset business portions; OD personal portion; recoverable tax if verified | M gross outflow | Only when recognition and actual payment share effective date; otherwise P14/P15 or prepaid route (§8/§24.2); tax not added twice |
| P13 Owner-paid business purchase / expense-splits | Business expense/asset; verified recoverable tax | OC business amount, or explicitly approved due-owner | Personal portion of owner's own payment excluded from business ledger; no fake bank credit |
| P14 Incurred unpaid purchase / payable-item | Expense/asset; verified recoverable tax | AP obligation | Vendor, incurred date, due date, source bill required; invoice image not second expense |
| P15 Pay supplier / settlement | AP settled | M outflow | <=remaining payable; settlement no expense again |
| P16 Supplier refund/credit / supplier-adjustment items | M refund, AP unpaid reduction, or supplier refund receivable in a named approved account | Remaining cost ranges' valid current classification and original recoverable tax | Cannot exceed unreturned original components; §24.2 dates and §24.5 reclassification/asset guards apply; no SR |
| P17 Transfer dispatch / transfer-leg | 1060 gross | Origin M gross | Actual departure, transfer lot+gross; no revenue |
| P18 Transfer arrival / transfer-leg | Destination M net; 5300 fee | 1060 gross consumed | net+fee=gross consumed; actual arrival and fee evidence; partial arrivals allowed, remaining transit visible |
| P19 Same-day confirmed transfer / transfer | Destination M net; 5300 fee | Origin M gross | Both legs confirmed on same date, no transit needed; gross=net+fee; cash/check deposits included |
| P20 Money-account fee / fee source | 5300 | Actual M | Explicit fee outside another template; identity prevents twice recording a net-settlement fee |
| P21 Owner contribution / equity-event | M | OC | Actual ownership contribution, not customer receipt or debt |
| P22 Owner distribution / equity-event | OD | M | Actual personal withdrawal; not operating expense |
| P23 Asset acquisition / asset-cost event | 1500 book cost; verified recoverable tax separately | M, AP or OC | D03 per-item classification, cost provenance and asset ID; no automatic threshold |
| P24 Capitalize previously expensed item / linked adjustment | 1500 approved cost | Original expense | Expense remaining basis and asset evidence; no second cash movement; locked-period direction required |
| P25 Manual book depreciation / asset event | 6200 | 1590 | Adviser-reviewed amount/method/period; <=remaining depreciable basis, no auto schedule |
| P26 Asset disposal / asset event | M gross proceeds; 1590 accumulated; 6300 loss if any | 1500 cost; 4300 gain if any; TX output tax if applicable | §9 supplies tax/proceeds variants, carrying-value formula; gain/loss not both |
| P27 Opening / opening-items | Verified debit-normal assets and debit equity positions | Verified liabilities/contra-assets/equity | Balancing documented 3000 on required side; zero P&L; AR/funds/AP/detail controls mandatory (§12) |
| P28 Tax remittance / tax settlement | TX | M | Verified liability/jurisdiction/period allocation and actual payment, not tax expense; no filing automation |
| P29 Borrowing / debt movement | M or acquisition asset | 2300 principal | Named documented debt, not contribution or revenue |
| P30 Debt payment / debt movement | 2300 principal; 6400 reviewed interest | M | Exact principal schedule; interest not principal; fees separate |
| P31 Reimburse owner / owner payable settlement | 2350 | M | Only existing approved obligation; previously contributed expense reimbursed via draw unless explicit contribution-to-payable correction approved |
| P32 Prepaid cost release / schedule event | Expense category | 1150 | Reviewed period benefit amount; no autonomous schedule, <=unreleased prepaid |
| P33 Explained unclassified outflow / suspense item | 1190 | M | Actual outflow known, business/personal/classification unresolved; explicit owner approval, evidence and resolution task; not verified asset value/profit |
| P34 Resolve suspense / linked adjustment | Approved expense/asset/OD | 1190 | Consume named suspense item, never post cash twice |
| P35 Unidentified inflow / unidentified receipt item | M | 2390 | Actual money, economic cause unresolved; no fabricated customer; resolve using exact customer/noncustomer branches in §24.4; return Dr2390 CrM with origin cap |
| P36 Reviewed non-control adjustment / adjustment source | Approved non-control account(s) | Approved non-control account(s) | Mandatory evidence/purpose; cannot recognize arbitrary service/tip revenue, erase equity, bypass control or impersonate customer/expense source |
| P37 Identified non-service income / other-income source | M | 4200 | Actual evidenced income such as bank interest, approved classification, money movement detail; not customer sale/tip, transfer, contribution or unexplained deposit |
| P38 Verified cash-count adjustment / count adjustment | Expense or1190 for shortage; Cash for overage | Cash for shortage;2390 for unresolved overage or4200 for established gain | Count evidence, cause and explicit review; typed cash movement/control; unresolved classification prevents clean close; cannot erase unidentified customer's claim |

P16 supplier refund receivable uses1120 with an evidenced unconditional claim/control schedule, never a cash account. Mapping `other_receivable` resolves1120 for approved supplier-refund or asset-disposal claims only. Known earned claims are recognized on their entitlement date and settled on actual payment date (§24.2); disputed/pending expectations remain unposted. Required metadata and typed movements follow the same payable/opening style. Settlement is DrM Cr1120, capped by the claim, with no second cost reduction. This is not an automatic purchasing feature.

A partial/multiple/split-method payment is repeated P03, not another template. One receipt over several invoices uses separate AR lines/allocations summing to its applied portion. Separate real payment methods require separate origin receipts even if checkout groups them. Standalone tip is P03 with zero AR/F, identified customer, intent evidence and optional job; no invoice fabricated. Unknown tax tip remains pending or, with explicit decision, all uncertain money stays F until classification; it cannot be posted as tax-free tip.

P03 with a provider-retained fee records Dr wallet net plus Dr5300 fee, credits the full customer receipt components. Gross customer receipt remains original refundable ceiling. The fee is a typed **embedded fee component** of that financial event, included once in expense reports and linked to the money-evidence envelope; it MUST NOT additionally post as a standalone P20 expense. P18/P19 and failed-outgoing-refund recredits in section24.3 follow the same exclusive embedded-versus-separate fee rule. If the provider reports a separate fee debit instead, use gross receipt/transfer and a separate P20 with its own money movement; embedded and separate modes are mutually exclusive per economic fee. Require evidence that gross was received and fee withheld, and require gross=net+fee. Pending authorization or notification alone cannot create a wallet asset. No direct card integration is implied.

### 4.3 Component conservation and lineage

Introduce a stable **funding origin** for each recorded receipt, approved opening customer-funds item, P35 unidentified-inflow item and reviewed nonposting legacy settlement reference (§24.6). Exactly one typed origin branch is permitted. Root amount is immutable. A receipt initially partitions into invoice applications, tip realizations and fund lots; unidentified inflow initially occupies a2390-held partition. On customer identification that partition moves to a customer fund lot without creating another root or another cash receipt. A verified noncustomer resolution consumes it into a terminal noncustomer classification (§24.4). Legacy evidence initially occupies a nonposting legacy-settled partition. Subsequent allocation changes preserve the root even when classifications change. Multi-root movements retain explicit child amounts. Each root's live partitions, net returned, net failed, terminal noncustomer-resolved and terminal opening-correction-removed amounts sum exactly to its root amount. Section12.3 defines the last category and its exact restoration. All nonnegative; no untracked remainder. Historic returned/failed amounts are imported only as nonposting capacity evidence, never current journals.

"Live" means currently applied to invoice, currently held in funds/unidentified liability, a retained realized tip, or evidenced legacy-settled value awaiting any later adjustment. Consumption never creates a second root. Unapplying an invoice component creates a funds descendant of that component; later funds application creates an allocation descendant; later conversion creates a tip-realization descendant. Credits change the charge, not root capacity. Every refund consumes selected eligible live root partitions. Financial failure consumes selected eligible live partitions. Cumulative **net** returned plus net failed <=root amount, after valid linked corrective reversals, with stronger per-descendant availability checks. Terminal noncustomer resolution is unavailable for customer refund; a genuine correction must reverse its typed economic effect before reopening capacity.

An opening AR item is a receivable origin, not a receipt root. Paying it creates a new receipt root. An opening funds item is a funding origin with reviewed historic receipt evidence and a remaining-refundable ceiling; prior pre-cutover returns are reflected in that ceiling, never imported as current refunds. An insufficiently documented opening origin cannot authorize a refund until reviewed; funds liability still cannot be called revenue.

Every adjustment has `corrects_event`, original source component IDs, reason, classification and economic date. Corrective reversals use a DAG: no self-link/cycle, same business, reverse remaining effect only, exact opposite source dimensions/account cents. An immutable link selects which correction is superseded. A second independent reversal of the same consumed amount fails even with another operation ID.

### 4.4 Failure, correction and dependent activity

Wrong entry with **no real money movement**: reverse the surviving recorded effects against the originally recorded money account and replace with correct source if one exists. A genuine dishonor/reversal **after real receipt** credits the account actually debited by the bank/provider on its actual failure date. If a check was deposited, credit bank, not the now-empty undeposited-check account. Preserve the original receipt/check/deposit chain. Bank charge is a separate fee. BR12.3 adopts this actual-debit-versus-recording-error distinction.

For a failed amount, explicitly select affected root portions. Current invoice applications debit AR and reopen only those charges. Unspent funds debit F. Retained tips debit TR/TX using original tax slices. If funds were moved to another invoice, reopen that invoice, not the original invoice that was credited. All affected descendants are resolved in one transaction. Owner must review the allocation plan; no oldest/newest guess for failure components.

If money was already actually refunded, a blanket full receipt reversal is forbidden. Do not undo the refund or reinstate a service charge to force balance. Reverse only the surviving eligible portion; record any additional confirmed bank debit under P33 as a specifically identified failed-receipt recovery exception linked to the refund/root. It requires adviser/owner review to establish genuine recoverable debt, expense or other classification; suspense is explicitly uncertain and blocks a clean close. The external cash debit must not disappear just because the ordinary reversal ceiling rejects it. This exception never increases the original receipt's refundable amount.

Refund correction: if the original record and economic refund decision were erroneous and no actual outflow occurred, reverse exact components and consumed ranges (DrM CrF for service/excess, DrM CrTR/TX for tip). If the refund obligation remains valid but its outbound transfer is rejected/returned, the actual recredit is **DrM CrF** for the returned amount, including a failed tip return: preserve the original service/tip reduction and restore the root as funds due to the customer. Retrying the actual refund then uses DrF CrM and cannot reduce revenue/tax a second time. Record refund-obligation type and original tax/revenue reduction IDs. Evidence must identify the returned original disbursement and amount <=its unrecovered returned capacity; no new customer receipt root. A later independent customer payment after a successfully completed refund is a new P03 receipt, not reversal of the old refund; it needs its own allocation/intent evidence. Reinstating a tip or service charge after a genuine concession requires explicit renewed entitlement/intent and the appropriate noncash reclassification, not an inference from cash arriving. §24.3 governs the complete distinction.

Service-credit correction: reverse remaining credit components exactly; restoring a real charge requires evidence the credit was erroneous and original accepted/completed scope still authorizes it. Reapply released funds only if still held and owner approves; returned money is not imaginary payment. A later new service obligation instead needs a new accepted scope and invoice. Original credits/refunds remain visible.

Transfers and expenses follow the same truth test: reverse erroneous records, but a true return of money is a new linked event on its actual date. Reclassification of a real paid purchase uses debit corrected category / credit original category, not fictitious money movement. If exact reverse-and-replace is used, both sides commit on the same effective date with a no-external-movement marker and preserve reconciliation lineage.

## 5. Invoice accounting and scope consumption

Issue requires BR11.1: accepted version/amendment, fulfilled approved allocation, customer/vehicle/location/service snapshots, item-level gross/discount/final amounts, verified tax profile, unique reserved number, explicit due date and owner review. Drafts may precede completion; no deposit invoice. Due date defaults to actual issue date; explicit later date allowed before issue. No automatic late fee. Economic service completion and actual issue remain distinct dates.

For incremental invoicing, owner partitions flat accepted scope into completed visit portions before issue. Each partition carries inclusive gross, inclusive discount and final value, not final value alone. Allocate accepted discount to portions proportionally to gross using largest remainder/stable allocation ID; all partition gross/discount/final totals must equal the accepted line. Store these frozen components at first consumption; do not reround the whole quote on every invoice. Tax is calculated on the resulting issued lines under the applicable verified profile; each line is its own original tax envelope. If legally required treatment differs across service dates, D01 must define that profile selection explicitly before issue; the engine cannot guess from payment date.

Track both monetary consumed value and fulfilled scope identity: a zero-dollar entitlement must still be consumed once. Scope revisions after consumption may partition only remaining scope. Ordinary concession credit does not free scope. A replacement invoice needs a correction chain and explicit released consumption; charge reduction, released-consumption transfer and replacement issuance MUST commit atomically under the finance/family locks. If replacement is not ready, keep the original consumption reserved, even after credit; never make it generally billable between commands. Cumulative replacement billing <=corrected authorized/completed entitlement; each predecessor consumption slice can transfer once to an explicitly identified successor. A partially credited invoice cannot be reissued in full. An amendment cannot erase already billed work without the financial correction path.

Invoice line fields distinguish inclusive gross/discount (`B`, `B−A`) from book gross/net discount (`G`, `d`). Formula P01: DrAR A + DrD d = CrSR G + CrTX t. With B=50000/A=45000 at non-taxable test profile, G=50000,d=5000,t=0. For B=0/A=0, no journal. For B>0/A=0, G>0,d=G: DrD G CrSR G, no AR/TX. A complimentary label alone must not suppress a real gross/discount pair.

For an invoice or opening receivable item as of date q:

`outstanding(q) = original charge + valid charge-restoration adjustments - cumulative charge credits - opening-charge reductions + opening-reduction restorations - net active applications`, using events effective <=q and known at the chosen report snapshot. Must be >=0 at every event boundary. Amount paid and amount credited display separately. "Settled" means outstanding=0. "Fully paid" requires payment settlement of the original charge with no charge credit; show "settled: payments + credits" when mixed. Zero complimentary invoices are "settled: complimentary." A full correcting credit may yield Reversed lifecycle; a partial concession never hides the issued original.

Before credit c, let charge_remaining=original less net currently consumed credit and opening-correction-removed offsets after exact restorations, allocations=p, current balance=b. Require c<=charge_remaining. Unapply `u=max(0,c−b)` from owner-selected live allocation components, creating funds descendants; then issue credit in the same transaction. If owner does not select exact origins, present a deterministic proposed plan by latest application effective date/sequence, but require confirmation before posting. Never unapply more than needed automatically. Afterward balance=b+u−c>=0. Refund remains a distinct confirmed event.

Receivable aging includes positive opening items and invoice items grouped by due date: Current (q<=due), 1-30,31-60,61-90,91+ days overdue. No negative buckets or netting one customer's credit against another's debt; funds are separate liabilities. Opening due date must be supplied or labeled unknown in a separate aging bucket; never fabricate it.

Normal field workflow: complete detail and save review task; owner reviews invoice plus actual received method/amount/tip; a combined finalization command issues P01 and records P03 atomically with separate source identities. If tax is unresolved, completion still succeeds but invoice/receipt classification cannot pretend success; save pending evidence or record permitted unallocated funds. External money receipt already happened independently of database success; an error must show "recording failed/unknown," never claim the customer was not charged or automatically retry external collection.

## 6. Payment-service accounting

| Method | Default destination rule | Verification / settlement |
|---|---|---|
| Cash | 1010 for identified business cash;1070 for owner-custodied mixed cash | Owner confirms physical receipt; deposit transfers cash to bank, not new sale |
| Check | 1020 | Owner confirms check custody and payer/reference; provisional collection may settle AR operationally; flag uncleared until deposited/cleared |
| Zelle | Actual dedicated business bank or mixed-personal custody channel | Verify credited transaction, not sender screenshot/pending notice; separate bank if multiple |
| Venmo | 1030 only if dedicated;1070 channel if mixed | Record credited provider balance; bank transfer separate |
| Cash App | 1040 only if dedicated;1070 channel if mixed | Same rule |
| PayPal | 1050 only if dedicated;1070 channel if mixed | Same rule |
| Other direct method | Explicit verified bank or named 1090 money account | No arbitrary method implies bank receipt; reject unsupported currency |

No assumption is made about actual Crest account ownership, fee plan or current provider features. the owner identifies each business money account in D02. A personally owned mixed destination MUST use section26's business-only owner-custody model. Dedicated1030-1050/1000 controls require actual verified dedicated business accounts. No whole personal balance is imported. Uncertain business scope stays unresolved, not an invented owner loan.

Pending/unverified receipts retain evidence but cannot clear invoices or affect reports. An actual credited but temporarily restricted provider balance may be posted only with evidence of Crest's ownership and a named restricted asset account; pending authorization alone is not that evidence. "Invoice settled by recorded check" and "bank-cleared" are distinct statuses.

Verified external identity registry: `(business, provider namespace, external account identity, provider-documented ID namespace, external ID)` unique across receipts, transfers, fees, refunds and statement matches. A settlement batch ID is not a customer transaction ID. Normalize only with documented provider rules; preserve raw reference and case where significant. Statement rows reference this registry, they do not independently create the same money event. A receipt ID reused for a refund must remain disambiguated by provider's documented namespace, not an arbitrary invented suffix.

Without reliable IDs, warn for same customer/amount/method/business-date and nearby evidence; require explicit "distinct actual receipt" reason for candidates. Checks additionally retain bank/payer/check-number evidence, not universal uniqueness on check number alone. Do not auto-delete equal transactions. Exact file hash/batch row identity makes import replay idempotent; overlapping differently formatted exports require registry or reviewed matching. Any uncertain identity stays staged.

Transfers spanning dates use P17/P18, with destination, gross, fee expectation (unknown allowed), departure/arrival evidence and remaining transit amount. On arrival, fee can be recorded only when confirmed; unexpected difference remains in transit with investigation, not fee by subtraction. Same-day two-sided confirmation may use P19. A failed dispatch actually returned by provider is Dr origin M Cr1060 for returned principal, plus explicit fee if withheld. A complete transfer cannot be erased because its statement match was wrong. Stale transit is a dashboard/close exception.

For verified dedicated business accounts, bank overdraft or negative provider balance must not be hidden by a balance>=0 constraint. Mixed-personal custody is different: section26 forbids negative business custody and requires an explicit personal-funding split; never treat the personal account overdraft as Crest debt. Permit evidenced negative money balance, flag it, and present/reclassify a true borrowing liability only after reviewed terms. Funds/AP/refundable partitions still cannot go negative. Physical cash negative is an immediate discrepancy requiring investigation, not invented cash.

## 7. Tax architecture and exact component allocation

Tax profiles: Unresolved, Verified Non-taxable, Verified Exempt, Verified Inclusive Single Rate. Each has jurisdiction, classification, service/tip applicability, evidence/reviewer, effective interval, version, reason, and synthetic flag. Exemption needs evidence applicable to that customer/transaction; an exempt customer label alone is not universal policy. Non-taxable is a reviewed classification, not an unset rate. Reject missing/overlapping effective versions and production synthetic use.

For each invoice line, resolve approved profile using invoice effective date under the existing BR12 convention, unless D01 expressly amends date selection. Preserve actual service date as evidence. Tip profile resolves on realization effective date; refunds/credits use original versions. For post-discount inclusive cents A and decimal rate r: N=round_half_up(A/(1+r)) to integer cents; t=A−N. G=round_half_up(B/(1+r)); d=G−N. Verified non-taxable/exempt uses r=0 for computation, retaining its distinct classification and evidence. No floating point, rate drift or extra checkout tax. Sums use wide exact arithmetic with overflow checks at storage boundaries.

**Credit algorithm, fixed for V1 including reversals:** original invoice line has A,N,t,G,d. Assign immutable inclusive-cent offsets1..A, represented as compact integer ranges, not one database row per cent. Define prefix functions `n(k)=round_half_up(N*k/A)`, `tax(k)=k−n(k)`, `disc(k)=round_half_up(d*k/A)` for0<=k<=A. Prefix0=0; prefixA gives exact N,t,d. A selected original range [lo,hi] has net=n(hi)−n(lo−1), tax=tax(hi)−tax(lo−1), discount=disc(hi)−disc(lo−1). Sum disjoint selected ranges. Each new credit consumes the lowest-numbered currently available offsets on its explicitly selected original line: exclude live credit-consumed and opening-correction-removed charge ranges. Opening reductions and credit consumptions share this capacity guard but remain different posting kinds. This equals cumulative target differences when no credit has been reversed, while also handling holes restored by corrections. Never substitute net credited cents for an original offset cursor.

Each credit stores its exact disjoint ranges and net/tax/discount amounts. Reversal restores those same ranges and reverses those exact journal components; ranges already restored cannot restore again. For a partial reversal select lowest offsets within the explicitly selected credit's remaining consumed ranges. Current credit/residual capacity is the set of offsets, not an independently rounded remaining amount. No range overlap at commit; full cumulative consumption yields exact original totals. Credited gross-net is credited net plus discount reversal. P07 debits R gross-net and TX tax; credits AR inclusive amount and D discount reversal. Reversal is exact opposite. Full-discount A=0 uses a single nonmonetary correction entitlement for its frozen G/d; correcting it reverses DrD/CrSR through exact DrSR/CrD, not a cash credit or R-only concession. Literal zero line has only the zero-event/scope history. No division by zero.

Tips use the same original-offset algorithm per tip realization, with disc=0 and one shared consumed-range registry across refunds, failures and tip-to-funds corrections. Restoration reopens exactly the original ranges, never a newly rounded slice with a new origin. Invoice credit ranges and receipt funding ranges are different controls: one reduces charges, the other tracks actual money. They are linked when unapplication creates credit funds but must not share or duplicate capacity. All arithmetic is exact integer/decimal, ranges are compact and cumulative sums overflow-checked. §24.1 records the counterexample fixed here.

Tax payable detail shows invoice/tip accrual, credit/refund/failure reversal, remittance, opening and approved adviser adjustment by jurisdiction/profile. Its net credit balance equals 2100, including possible debit balance after refund of previously remitted tax. Such debit is flagged as a potential recoverable tax position pending adviser direction, not forced to zero or booked as revenue. Remittance allocation does not re-recognize expense. A tax refund from authority uses DrM CrTX against verified claim/previous debit; not service revenue.

**D01 must resolve before relevant real postings:** each service and tip's taxability; jurisdictions and any exemption evidence; rate/effective interval; legal recognition date; flat-price presentation requirements; discount and partial-credit treatment; legally required rounding; remittance/control requirements; purchase-tax recovery if used. If required composite/compound rates or a different rounding/presentation basis cannot be represented here, amend this contract before activation. Real tax is not inferred from synthetic 10%. Unknown tax does not block synthetic engine work or non-tax-sensitive funds/owner/money transfers with approved mappings.

## 8. Expenses and purchasing

Required source: incurred date, recorded date, vendor or explicit unknown-vendor reason, gross amount, business purpose, classified splits, funding identity, owner approval, receipt links or missing-receipt reason. OCR may suggest only; no model can approve/post. Purchase evidence can be several files, a shared invoice or missing with explicit reason. Missing evidence is visible in reports and close review, not fabricated as "verified."

Normal supplies: recognize expense at incurred date, gross including verified nonrecoverable purchase tax. P12 combines recognition/payment only when those dates coincide. If payment is later, P14 records expense/AP on incurred date and P15 debits AP/credits money on actual payment date, even if entered together after both happened. If payment precedes the benefit, record Dr1150/CrM on payment date with prepaid schedule, then Dr approved expense/Cr1150 on incurred/benefit date. Owner-funded timing follows §24.2. Never credit bank on incurred date merely because a bill is now marked paid. Store receipt tax as metadata within gross, not an extra debit on top. A recoverable purchase-tax policy uses separate1180 detail only when verified; unknown recovery/classification remains Needs Review or explicitly approved P33. Split allocations distribute gross and its tax component deterministically by reviewed item amounts; split sum=gross. Job allocations sum<=business split cost; unallocated remainder=overhead. Personal portion never joins job profitability.

Business-paid mixed transaction: debit business expense/asset for business portion, OD for personal portion, credit actual account for total. Owner-paid mixed transaction: business books record only business portion Dr expense/asset CrOC (or approved2350), retain full receipt gross and excluded personal portion in source evidence. Check `business posted + excluded personal = owner-paid receipt total`; no personal component is credited to business bank. Reimbursement obligation must be chosen explicitly; do not select equity versus liability merely from a payment-method label.

Unpaid incurred supplier bill creates AP item; payment settles AP only. Due date required; unknown recorded explicitly if source truly lacks terms. Partial payments and credits cannot exceed remaining AP. Supplier refund follows remaining original cost ranges and their current reviewed expense/asset/purchase-tax classification, including later reclassification (§24.5). Owner-funded refunds use §24.5's contribution/reimbursement distinctions rather than fictitious business cash. A refund larger than original remaining cost needs separate documented economic classification, not negative expense cost by default.

Prepaid benefits and assets are not automatically expensed for simplicity. When identified, use reviewed schedule and P32 manual releases; otherwise hold review/suspense. Suspense requires known actual money movement, an explicit reason, owner approval, assigned resolution task and unresolved age; it is not an automatic posting fallback. Financial reports prominently state uncertain classification, and clean period close is blocked by unresolved suspense. A late classification changes the correct period only through §11, not by editing the purchase date.

Expense-to-ledger reconciliation: business expense splits, supplier returns, reclassifications and prepaid releases grouped by account/date must equal corresponding ledger movement; distinguish fixed-asset and owner portions. Net cash paid to suppliers also includes AP settlements, excludes unpaid accruals and separately shows owner-paid costs. Duplicate receipt hashes and vendor/document identities prompt review; source events-not image count-control expense uniqueness.

## 9. Fixed assets: minimal gated framework

Maintain asset ID, label, category, purchase cost/date, source/vendor, ownership and business-use evidence, cost basis approved for books, in-service date, residual value if chosen, useful life and method (nullable/unresolved), adviser/policy version, accumulated depreciation from events, status, disposal date/proceeds/evidence. An equipment reference list without posted basis is explicitly nonfinancial; approximate historical $10,000 equipment context never seeds1500.

Acquire using P23 with an actual funding source. If a paid item is capitalized later, P24 reclassifies its approved remaining expense basis, not another purchase. Opening assets use supported historical cost and accumulated depreciation separately; do not post current replacement value as cash investment. Depreciation may remain inactive; show "depreciation not assessed/recorded" and incomplete valuation warning where relevant. An unresolved policy cannot justify silently presenting assets at cost as verified carrying value.

Manual depreciation source specifies asset, covered interval, basis/residual/method/life or adviser calculation, approved cents, and reason. Require available depreciable basis, nonoverlapping covered periods unless explicit correction, in-service chronology and disposal boundary. No automated depreciation in V1. Book versus tax depreciation differences belong in adviser metadata/export, never one silently reused number.

Disposal: for cost K, accumulated depreciation H and net-of-output-tax proceeds P, carrying amount V=K−H; gain=max(P−V,0), loss=max(V−P,0). Dr actual M gross proceeds, Dr1590 H, Dr6300 loss; Cr1500 K, Cr4300 gain, CrTX output tax if verified applicable. Gross proceeds=P+tax. If not paid, use a specifically reviewed disposal receivable schedule rather than a normal service invoice. No-tax synthetic examples do not authorize real sale tax assumptions. Dispose once; preserve asset and all events. Partial disposal needs an approved cost/depreciation partition before posting; never guess a percentage.

D03 controls capitalization threshold, repairs vs improvements, business use, book lives/methods/residuals, ownership/basis, treatment of old equipment and any tax election. Framework may be implemented with synthetic fixtures. Actual uncertain purchase stays review; optional register UI must not be mistaken for permission to bypass asset-control detail.

## 10. Reconciliation

### 10.1 Workflow and exact balance equation

For mixed personal channels, use section26's business-only custody reconciliation instead of a full personal statement balance. For dedicated business accounts:

1. Select one actual money account and complete statement interval, statement opening S0 and closing S1, provider/date convention, file hash and evidence. Confirm continuity to last reconciled statement; first interval ties to approved cutover opening bridge.
2. Import rows as nonposting evidence. Require `S1−S0 = sum(signed statement rows)` after documented provider conventions. Missing pages/transactions or duplicate statement rows block approval. Balance sign is asset increase positive.
3. Match existing typed money movements first. One-to-many and many-to-one matching allocate exact signed cents through match children; no row or movement amount may be matched twice across overlapping reconciliations. Opposite signs cannot be netted away as a shortcut. A true provider net settlement needs explicit gross/fee children or a documented grouping whose net equals the row, preserving all components.
4. New unmatched real transactions create reviewed normal sources; imports do not create postings automatically. Transfers match both accounts' legs to one transfer chain. Fees use actual evidence. Unknown inflows/outflows follow P35/P33 only with explicit approval, and retain unresolved close warnings.
5. Classify book movements not yet present on the statement as individually evidenced **outstanding timing items**. Carry these IDs forward until they clear; record expected clearing date and reason. Never fabricate a timing item for an unexplained difference. A statement movement missing from books must be posted or corrected before approval, not parked as a generic plug.
6. At statement end q, let B be ledger money-account balance through q; O be signed sum of valid book timing items outstanding at q, including opening timing items; S1 is statement closing. Require `B − (S1 + O) = 0`. Deposits in transit are positive O; issued uncleared withdrawals negative O. Each O item must belong to the account and have a book/opening origin. Inter-account transfer1060 is separately reconciled to transit lots, never counted again as a bank timing item unless bank book balance actually includes it.
7. Approve only with zero difference, complete row matching, supported timing items and current generation/hash. Record actor, timestamp, balances, movement IDs, match amounts and unresolved non-matching exceptions. "Reconciled" means this account/statement is reconciled, not that all book classification/tax/openings are complete.

Reconciliation is optimistic during preparation; on approval acquire finance lock, recheck all versions, recompute and freeze snapshot/matches. Period locks use same lock. A new backdated money event, correction, opening adjustment, unmatch or changed statement evidence invalidates affected reconciliation and later continuity-dependent ones. Classification-only adjustment with unchanged money may leave account arithmetic valid but invalidates period report/close generation; require documented review, not silent reliance on old exports. Pure new future activity outside interval does not invalidate it.

### 10.2 Account-specific controls and no plugs

| Control | Expected equality | Exception/resolution |
|---|---|---|
| Bank/wallet statement | B=S1+O, complete row matches | Investigate unmatched/duplicate/missing source; typed corrections only |
| Cash count | Counted notes/coins = ledger1010 as of count | Capture signed count variance; investigate and approve actual gain/loss or classification source with reason; no "set balance" |
| Undeposited checks | Sum current checks held =1020 | Confirm custody/deposit/dishonor chain; missing check remains exception |
| Transit | Sum dispatched less arrived/returned lots =1060 | Investigate stale lot/fee; never quietly expense whole transit |
| AR | Sum invoice/opening item outstanding =1100 net debit | Halt affected finance; rebuild/repair from sources, not generic manual journal |
| Customer funds | Sum all live customer lots =2000 net credit | Include descendants and opening roots; reconcile per customer/root |
| Owner custody | Business-only custody lots equal pinned1070-family debit balances and section26 evidence bridge | No full personal balance, automatic netting or unsupported negative custody |
| AP/owner/debt | Sum typed remaining obligations =2200/2350/2300 | No unsupported aggregate opening or repayment |
| Tax/asset/prepaid/suspense | Detail schedules equal control balances | Every adjustment requires schedule effect and evidence |

Explained adjustment means a real source with amount, cause, account classification, evidence, effective date and approval-not a balance chosen to make difference zero. An actual unexplained cash shortage may be captured as a reviewed suspense investigation, but cannot yield a clean close until classification resolved. Review stale outstanding items monthly. No blanket auto-clear after an age threshold.

## 11. Period close and corrections

Book periods are nonoverlapping local calendar months for V1, with a possible partial initial month at cutover. This is a book convention, not a tax-year election. Open and Locked are enforcement states; "review in progress" is workflow status. Every effective date must belong to one configured period; absent period fails explicitly. Lock requires consistent controls, approved openings for covered accounts, relevant account reconciliations, reviewed outstanding items, no unresolved suspense/duplicate posting candidates, no undisclosed unbilled completed work and no unresolved required tax classification. Pending known drafts/unbilled work must be resolved or explicitly listed in an approved incomplete-period close; that close is visibly qualified, never "complete books." Control mismatches cannot be waived, even in qualified close.

Lock stores closing trial balance/control totals, report snapshot/generation, reconciliation IDs and exception register. It prevents all dated posting, reversal, opening correction and finance-affecting source changes within interval. Owner access does not bypass it. Unlock requires recent authentication (15 minutes per SECURITY), reason, scope, actor/time, prior lock evidence and invalidation of dependent close/report/reconciliation generations. Relock requires fresh checks. Preserve original close exports and mark superseded, never overwrite.

Default correction of a locked date: append in selected open period with original economic date and prior-period flag, explaining that current-period book results include the correction. Prior reports are not restated automatically. If materiality or appropriate period is uncertain, route to adviser; developer cannot choose equity or a prior-year adjustment to make profit look right. Adviser-directed reopening/reposting is explicit and audited. Invoice issued_date and original posted rows remain immutable even when a correcting date is prior-period.

Every event requires source chronology. A normal application cannot precede its invoice/opening and receipt/funds availability. A credit cannot predate issue. An amendment cannot retroactively grant scope to an already issued invalid charge without explicit correction. A backdated allowed event triggers chronological replay checks for every affected item/lot, not just today's balance; reject if any historical effective-date/sequence boundary becomes negative.

Annual close: do not automatically post revenue/expense-to-equity closing journals. Display accumulated earnings virtually (§13), with book-year filter configurable separately from tax filing. This avoids double counting earnings after two years. If explicit closing-entry mechanics are ever added, that is a contract/version change with regression tests; generic manual journals cannot simulate it into reserved current-earnings roles.

## 12. Opening and prospective cutover strategy

**No historical ledger import.** reviewed legacy customers/vehicles/contact records enter through CRM preview/mapping/deduplication only. Prior financial evidence remains outside live ledgers or reference-only. Opening AR is not a new invoice/revenue; opening funds are not new receipts/cash. Prior-year records remain available to accountant separately.

Prefer owner-selected local midnight for cutover so a `date` ledger can express the boundary cleanly. Record date, zone and exact UTC instant. Intraday cutover is allowed only with a complete pre/post transaction roster and `boundary_sequence` that puts the opening before all post-cutover events on that date; retain actual instants and disclose that date reports include only part of day. No silent UTC-midnight substitution. The specification selects a method, not Crest's actual start date.

Opening represents the business position **immediately before** that boundary. Opening entry effective_date is cutover local date, sequence0; ordinary post-cutover events follow. Opening subledger rows must retain original due dates, supporting documents and external identities. Service completed before cutoff but genuinely not billed is a separate named exception: either establish an evidenced opening receivable if a charge existed, or include it in the approved boundary schedule for later explicit issuance, with pre-cutover-work warning. Never count it in both. Accrued liabilities, prepaid costs and earned-but-unbilled work need adviser review for completeness; prospective operation does not erase them.

### 12.1 Owner opening/cutover checklist

- [ ] Approve scope, exact instant/zone, authoritative prior source, responsibility and per-account boundary. Mark each account Verified amount / Verified zero / Unknown / Not applicable with evidence; blank is not zero.
- [ ] Inventory actual business bank/wallet accounts and ownership; retrieve statements/activity spanning boundary. Reconcile settled balances to book balances and identify outstanding checks/transfers/deposits individually.
- [ ] Count physical cash and identify every check held. Exclude cash belonging to another business/person.
- [ ] List each open customer receivable: customer, legacy reference, original charge/credits/payment evidence, remaining amount, due date, service scope, original tax metadata if known and all pre-cutover receipts. Only **remaining AR** enters1100.
- [ ] List each customer-funds balance: customer, original money/evidence, current amount held, historical classifications/refunds, refundable ceiling and owner obligation. These become opening funding roots; not new bank receipts.
- [ ] List unpaid supplier bills, amounts due owner, debt principal, interest/accruals, tax liabilities and other real obligations. Verify zero rather than assuming it. Distinguish business from personal debt.
- [ ] Review equipment and prepaid assets: decide included book cost/accumulated depreciation/supporting evidence or explicitly incomplete schedule. Do not import approximate equipment spending as verified assets.
- [ ] Reconcile draft trial balance, AR/funds/AP/tax/asset controls, each money balance and opening timing bridge. List omissions/uncertainties with resolution owner. A missing account may block complete opening approval rather than being plugged.
- [ ] Derive net opening equity from supported assets less liabilities and contra-assets, then document how it relates to prior business capital/earnings or why it remains a provisional net position. Preserve worksheet and evidence. A balancing number alone is not verification.
- [ ] Preview exact opening entry and all subledger details; verify P&L effect=0 and no duplicate historic receipt/invoice posting. Record D02/D12 approval and immutable plan hash; finance lock makes posting atomic.
- [ ] Run opening/control/reconciliation checks, export signed-off schedule, test recovery of openings, establish primary-system boundary. No "complete books" or primary cutover while required balances remain unknown.

Opening drafts may be saved with unknowns; synthetic/test opening approval does not authorize real launch. A limited real pilot with qualified incomplete openings must remain explicitly non-primary, and still requires known balances for every account/item it uses, all safety/tax gates and an approved bounded coverage plan. Do not let a generic opening-approved checkbox mark unknown accounts verified.

### 12.2 Opening-item behavior

Use a typed `receivable_item` parent with exactly one origin: issued invoice, opening AR item, or documented post-cutover legacy-collection failure (§24.6). Allocations/credits/aging/control links target it. Opening item original charge is its **remaining cutover balance**, not old full invoice amount. Metadata may retain the old invoice, but number remains a legacy reference; never allocate a new Crest invoice number or consume new commercial entitlement for it.

A later collection of opening AR is DrM CrAR. A genuine post-cutover concession against it needs documented original service/tax components; if unavailable, hold credit Needs Review. A correction that the opening balance was wrong instead adjusts AR against3000 with original opening evidence and no fictitious current sale/return. Do not use opening equity for a real new concession to avoid current-period loss. This distinction is mandatory.

Opening funds: Dr3000 CrF (combined with other opening components). Later apply DrF CrAR, return DrF CrM or verified tip conversion DrF CrTR/TX, preserving root. Opening bank includes the already-held cash; do not debit bank again for funds opening. Opening corrections are appended linked detail changes with source/control checks and period rules, never re-run the entire opening batch as new money.

Restore/cutover replay prevention: immutable cutover ID, one primary opening event per business cutover, with linked delta corrections for subsequent plan revisions, original external identity registry and batch hash. Restored backups require incident reconciliation of later activity, reservation of any externally issued invoice numbers and recovery of operation/source identity tombstones where possible. If evidence for post-backup money is uncertain, freeze affected financial reopen until reconciled; do not generate a new sequence from the restored maximum and call it safe. This follows EXPORTS_AND_BACKUPS §7 and does not change the owner decision to continue ordinary writes merely during a backup-age alert.

### 12.3 Exact opening corrections and capacity

An opening error is not a customer payment, refund, collection failure or current concession. Only the primary opening group has opening-before-ordinary priority; supplemental corrections follow normal correction ordering/dependencies on their approved effective date. All approved deltas retain the original opening item, evidence, correction date/period and separate immutable adjustment identity; the initial amount never changes.

For an understated opening customer-funds liability, post Dr3000/CrF for the verified increment and create a supplemental opening item/root for exactly that increment, linked to the original item and correction. Never increase the original root amount or overlap historic receipt capacity. For an overstated liability, post DrF/Cr3000 against explicitly selected still-live funds ranges and move those ranges to terminal `opening_correction_removed`. Extend root conservation to include this terminal amount separately from returned/failed/noncustomer amounts. It is not an actual refund or loss. If affected ranges were applied, tipped or refunded, reject a simple reduction; first resolve those dependencies through an explicit same-date typed correction plan with valid entitlement/intent and no fictitious money reversal. An actual refund cannot be erased to manufacture available capacity. Unsupported plans remain blocked.

Reversing a downward opening correction restores exactly its removed ranges with Dr3000/CrF; repeating restoration fails. Reversing an upward correction consumes that supplemental root's eligible live ranges with DrF/Cr3000 under the same dependency rules. Original and supplemental root capacities remain separate. Wrong-customer reattribution uses section24.3, not a new root.

Opening AR increases append a supplemental opening receivable item with verified remaining charge/component evidence; DrAR/Cr3000. Reductions debit3000/creditAR on selected unallocated remaining charge ranges, recorded separately from concessions and unavailable to later credits until exactly restored. Reversal restores exact ranges; live allocations must first be unapplied atomically where legitimate. Do not invent original tax/discount components; unknown components block later credits that need them. Opening custody increases create a supplemental custody lot DrC/Cr3000; decreases consume selected available custody slices Dr3000/CrC. Spent/distributed descendants require an explicit typed correction plan and all chronological nonnegative checks. None of these deltas creates external cash evidence or a personal contribution. Tax/asset/AP/other opening corrections likewise require exact typed schedule deltas; no control-only equity plug.

## 13. Financial reports

All reports use a consistent database snapshot, effective-date filters and immutable ledger/source joins. Include business, USD, local zone, report definition version, recorded snapshot time, effective interval/as-of date, coverage start, opening completeness, tax/config status, unposted/unbilled/suspense counts, reconciliation/lock generation and correction warnings. Draft sources excluded. Include originals **and** reversing entries on their effective dates; never exclude a source's historic journal merely because its current lifecycle says Reversed.

| Report | Calculation / source | Required control and drill-through |
|---|---|---|
| Trial Balance | Balance through q is the sum of all posted signed lines through q, including P27 exactly once. For an interval [s,q], report opening=sum(lines before s), movement=sum(lines from s through q), closing=opening+movement | Total debits=credits; no extra addition of stored cutover balances; account→journal→source |
| General Ledger / account detail | Every posted line in effective_date/event-sequence/entry/line order, with opening running balance | Running balance equals TB; includes correction and archived accounts |
| P&L | SR credits−debits, less D and R net debits; plus TR/other income net credits; less expense net debits over interval | Net income matches ledger P&L account movements; separate gross/discount/return/tip/tax-excluded lines |
| Balance Sheet | Assets (1590 subtracted), liabilities, posted equity incl OD deduction, plus derived accumulated earnings | A=L+E; no hidden negative wallet; openings warning |
| AR Aging | Positive item outstanding as of q, due-date buckets (§5) | Sum=1100; invoice/opening→credits/applications→roots |
| Customer funds | Live lots by customer/root/date, application/refund/tip movement history | Sum=2000; never net against unrelated AR |
| Payable/owner/debt detail | Outstanding typed obligations and movements | Sum matches each liability control |
| Expense report | Reviewed business expense components + releases/adjustments − supplier returns, excluding OD/assets | Ledger expense accounts reconcile; separately disclose owner funding/unpaid costs |
| Revenue report | Net service by immutable invoice item/service/vehicle/job/source/location; unallocated bucket | Sum service totals=4000−4900−4910; multi-job data not duplicated by joins |
| Tips report | Original and reclassified tip net less refunds/failures/corrections | Sum=4100; tax separately, root/customer evidence |
| Discount/returns | Gross invoice discounts less credited discount; gross returns and net concessions | Net totals exactly4900/4910; distinguish customer-inclusive and book-net amounts |
| Payment-method/account movement | Actual incoming/outgoing sources by effective date; separately group customer collections, refunds, owner, transfers, fees, supplier/debt movements | Per-account movement plus opening=TB account; customer receipt gross distinguished from fee-net deposit |
| Reconciliation report | Statement, book balance, matches, timing list, difference, generation/status | Equation §10; evidence files, invalidations and superseded approvals retained |
| Asset register (if used) | Cost/additions/disposals, accumulated/manual depreciation, carrying amounts | Sum cost=1500, depreciation=1590; unresolved valuation flagged |
| Tax detail | Profile/jurisdiction source tax, reversals/remittances/openings | Sum=2100; not tax return |
| Mileage | Physical confirmed legs once, vehicle/purpose/source, estimated separate | No ledger expense automatically; preserve adviser evidence |

**Earnings without double counting:** let total posted equity E0 be net equity credit balances through q including opening equity, contribution, distributions and approved equity adjustments. Let cumulative earnings E1=sum of all P&L credit-minus-debit balances since cutover through q. Total equity=E0+E1 exactly once. For display, split E1 into earnings before selected book year and current book-year earnings; those display lines sum to E1 and are not extra ledger accounts. Midyear cutover means current-year books have partial coverage. Do not add the chosen P&L period result again to cumulative earnings.

Default label is **Recorded-book net income**, with coverage warning whenever openings, costs, unbilled work, assets/depreciation, suspense or reconciliations are incomplete. Complete book P&L still does not measure owner labor opportunity cost or certify taxable profit. Cash collections are not cash-basis taxable income. Date-basis labels accompany operational completion-cohort reports so they need not equal a different effective-date P&L cohort; provide a reconciliation bridge if shown together.

## 14. Financial dashboard integration

Accounting cards: net service revenue, net tips, posted expenses, recorded-book net income, AR, customer funds, customer cash collections/refunds. Use §13's same queries/filters/snapshot; each opens the exact contributing rows. Exclude owner funding, wallet transfers and customer excess from service revenue. Show gross receipt/fee-net money distinctly where applicable.

Operational cards: completed but unbilled scope; unposted expense/receipt drafts; uncertain-save operations; pending checks; duplicate candidates; unidentified money; unresolved funds; stale transit; unreconciled statements; qualified/locked periods; backup age and last recovery drill. These are exception counts and estimated obligations, not ledger balances. Scheduled contracted value remains operational all-in value and is never recognized sales.

Show persistent incompleteness banner rather than a bright "real-time profit" badge. No default-zero cost/tax/opening. Missing data makes related margin/contribution unavailable or qualified under BR14. Backup age alone does not block posting: explicit owner amendment permits continued writes with alerts. An accounting control mismatch does block affected financial commands; these are different conditions.

## 15. Accounting control and reconciliation matrix

DB=constraint/trigger/restricted routine; TX=transactional command; scheduled=at least daily and before close/export/release. Every listed failure alerts the owner in-app; integrity failures additionally use the approved security/operations alert path without customer data. Tests below are required implementation acceptance tests, not executed engine tests.

| ID / invariant | DB enforcement | TX enforcement | Scheduled check / test | Alert and corrective workflow |
|---|---|---|---|---|
| C01 Balanced source journals | One-sided positive lines, deferred sum and source-completeness trigger, event/sequence unique | Template amount/account validation | Recompute every entry; fault after each insert | Critical; rollback; investigate source/template, no plug |
| C02 Source posted once | Unique typed source transition and operation key/hash | Same-key result replay; distinct source identity check | Duplicate source scan; same/different-key races | Conflict; recover original event |
| C03 AR matches items | Typed same-business/customer FKs; restricted control writes | Item charge/application caps under finance lock | Ledger vs items per customer/item/date; test paid credit and openings | Halt affected postings; trace and correct source |
| C04 Funds matches lots | Root/lot/movement FKs, no raw control journal | Conservation and available-lot checks | Sum lots vs2000 by customer/root; move→tip→refund tests | Halt funds domain; rebuild projections or linked repair |
| C05 Allocations <=charges | Deferred item aggregate guard | Lock, chronological replay, stale-version reject | Random apply/unapply/backdated sequences | Reject; owner reviews new balance/excess |
| C06 Refund/failure ceilings | Root/descendant cumulative bounds; correction links acyclic | Explicit component selection and net caps | Partial refund+failure; opening funds; reclassified tips | Reject unsafe; record true excess bank debit as reviewed exception |
| C07 Revenue semantic source | Restricted SR/TR accounts; allowed source kind/component | Completed entitlement and intent/profile checks | Ledger→invoice/tip recompute; balanced wrong-account injection | Critical classification alert; linked correction |
| C08 Transfers not sales | Typed transfer account-role constraints | Distinct asset accounts; gross=net+fee; two-leg dates | Transfer control1060; net settlement/replay tests | Stale/incorrect transit; evidence correction |
| C09 Owner equity not P&L | Equity-event allowed accounts, owner FK | Contribution/draw/loan distinction explicit | Funding classification scan; mixed purchase tests | Review/reclassify, no silent bank change |
| C10 No manual control bypass | Revoke generic writes; control line requires typed movement | Reviewed adjustment allowlist; direct-control rejection | Role introspection; direct SQL and routine abuse tests | Deny and log; typed source required |
| C11 No unresolved tax | Posted source references verified nonsynthetic profile | Applicability/date/line/tip checks | Missing/overlap profile scan; unresolved/synthetic rejection | Block affected classification; D01 task |
| C12 Immutable history | UPDATE/DELETE guards on posted fields/lines and audit; RESTRICT FKs | Reversal/replacement only | Historic hashes/backup anchors; malicious edits | Security/integrity incident; privileged recovery review |
| C13 Period lock | Routine guard reads lock under finance lock | Explicit unlock/recent auth; effective-date checks | Locked-date race and chronological tests | Reject; open-date correction/unlock |
| C14 External identity unique | Unified verified identity registry unique | Manual/import matching share registry | Cross-source duplicate scan; overlapping files | Link existing movement or resolve evidence |
| C15 Ambiguous duplicates reviewed | Posting requires candidate-review evidence/version | Candidate search under finance lock; no amount/date hard uniqueness | Two legitimate cash payments vs duplicate test | Pending review; explicit distinct reason |
| C16 Opening detail ties | Cutover/source unique; control detail required | Approved plan hash; verified/unknown status distinction | Opening trial balance+account bridges; replay test | Block primary cutover/complete statements |
| C17 Statement reconciliation exact | Match allocations bounded; evidence immutable; generation FK | Recompute B=S+O; no unexplained gap | Split/combine/overlap/backdated invalidation test | Needs Review; correct/match sources |
| C18 Discount/tax conservation | Original component bounds and disjoint consumed-range checks | Original-offset prefix differences, exact range restorations and terminal residual | Random partial credits and non-last reversals; full-discount case/R01 | Rollback bad credit; arithmetic defect investigation |
| C19 Scope not billed twice | Stable entitlement/consumption FK and deferred cap | Family+finance locks; zero-scope consumption identity | Concurrent incremental/replacement/zero invoice tests | Reject; amendment/correction review |
| C20 Report/earnings consistency | Immutable snapshots/definition IDs | Same snapshot all formats; no reversed-history exclusion | TB/P&L/BS and source dimensional tie-outs; two-year fixture | Mark report invalid; block release |
| C21 Restore doesn't replay money/numbers | Recovery epoch, full-number reservations and persistent economic identity constraints | Reject stale commands; incident reconstruction/aliases before financial reopen | Restore with later issued/refunded events | Freeze affected recovery; reconstruct/reserve evidence |
| C22 Auxiliary controls | AP/debt/asset/prepaid/tax/suspense typed detail | Source/cap/chronology validation | Per-account schedule vs ledger | Pause affected domain; reviewed source repair |

Integrity monitor records business/date/snapshot, expected/actual cents, offending source IDs and check version. It cannot repair by writing offset entries. A projection-only defect may be rebuilt from immutable validated events with logged before/after checks. Source corruption requires reviewed reversal/replacement or controlled incident recovery. A business-wide unexplained TB/ledger mismatch pauses all finance writes; localized control mismatch pauses commands touching that domain and dependent corrections, while read/export/CRM continue. Do not mark a failing check "acknowledged = resolved."

## 16. Accounting error states

| Code / situation | Required outcome | Recovery |
|---|---|---|
| POSTING_FAILED after source validation | Roll back source transition, journals, all subledgers and operation claim | Preserve user draft/evidence; report no confirmed posting; retry same reviewed operation |
| PARTIAL_SOURCE_JOURNAL | Must be impossible at committed boundary; deferred constraints reject | Incident if detected in existing data; pause and trace privileged writes/migration |
| OUTCOME_UNKNOWN timeout | Do not show success/failure or submit new operation | Lookup authenticated operation; retry same ID/payload; absent does not prove in-flight failed |
| MAPPING_NOT_READY | No guessed account or partial post | Configure/approve version, review again |
| TAX_NOT_READY | No invoice/tip tax classification | Draft evidence or explicit permitted funds receipt; resolve D01 |
| PAYMENT_EXCEEDS_BALANCE | Real distinct receipt retained; cap allocations and put remainder in F | Show updated split and require confirmation if command's requested allocation became stale |
| DUPLICATE_REVIEW_REQUIRED | No new posted receipt while ambiguous | Show candidates; link original or confirm distinct evidence/reason |
| CREDIT_EXCEEDS_CHARGE | Atomic rejection | Show remaining original charge components; revise request |
| REFUND_EXCEEDS_AVAILABLE | Atomic rejection | Show root/component history; no artificial credit/refund ceiling increase |
| PERIOD_LOCKED / PERIOD_MISSING | Reject affected dated financial command | Select valid open date with original reference or audited unlock/create period |
| CONTROL_MISMATCH | Pause affected finance; prominently flag reports | Reconcile source/control; restore or linked correction, not manual plug |
| RECONCILIATION_STALE | Preserve prior approval, mark Needs Review | Recompute matches/continuity, approve new generation |
| IMPORT_UNCERTAIN | Keep staging and original rows, no journal | Owner maps/matches/rejects; safe retry accepted identities |
| OPENING_INCOMPLETE | Save draft and explicit unknowns; no verified balance sheet/primary cutover | Collect account/detail evidence and approve plan |
| COMPONENT_DEPENDENCY | Refuse blanket reversal of spent/refunded/reclassified money | Build reviewed descendant correction plan; true exceptional debit follows §4.4 |
| BACKDATED_NEGATIVE_HISTORY | Reject even if today's aggregate is nonnegative | Choose truthful date or correct dependencies explicitly |
| MONEY_EVIDENCE_MISSING | Keep Pending; never claim external payment initiated/failed | Confirm actual account movement, then record |
| UNSUPPORTED_TAX_OR_CURRENCY | Reject affected posting | Amend verified contract or retain evidence; no approximation |
| BACKUP_STALE | Continue ordinary writes per owner decision, persistent warning/alerts | Restore backup service; record unprotected interval; unrelated integrity gates still apply |

No failed response automatically sends a customer message, collects/refunds money or changes a provider account. Failed/unverified evidence remains visible so actual money is not forgotten.

## 17. Auditability and provenance

Every event must answer: what occurred (typed kind/components/narrative); economic time and accounting date; when recorded/posted; who approved; source customer/job/invoice/expense/vendor/owner; account debit/credit; purpose/reason; original and correction chain; external evidence; and policy/mapping/template/tax version. Include stable operation/source identity, money origin and movement IDs, period generation and evidence checksum/reference. Preserve raw external identifiers privately and normalized identity rule version. Do not put secrets in audit/export.

Financial source hashes cover immutable amounts/dimensions/dates/config versions and typed relationships. Audit logs record approval, period unlock, duplicate confirmation, import decision, match/unmatch, opening approval and restore actions. External backup/hash anchors provide tamper evidence, not a claim of administrator-proof storage. Attachments may be missing with a reason; a hash without accessible bytes is not adequate recovered evidence. Never delete posted records by archiving a customer/vendor/account.

An accountant tracing any journal line can navigate line→entry→event→source component→agreement/completion or purchase/money evidence→corrections→report. A funds refund additionally traces every root and prior application/unapplication; no generic "adjustment" explanation can substitute for typed provenance.

## 18. Accountant handoff specification

Provide a selected-period/as-of package built from one consistent snapshot under EXPORTS_AND_BACKUPS §2. It must be usable independently of Crest login/provider. No actual account handoff or message is sent by this specification.

| Deliverable | Required contents |
|---|---|
| README/coverage | Business identity, book basis, USD/zone, cutover, known omissions, unbilled/drafts/suspense, lock/reconciliation status, tax/asset policy unresolved items; explicit no tax-return preparation claim |
| Financial statements | P&L, balance sheet, trial balance, AR aging and funds/AP detail in useful XLSX plus readable PDF summary and exact CSV |
| General ledger | Every line, source/dimensions/account code, effective/recorded/posting dates, opening/running balances, correction chain, mapping/template IDs |
| Commercial sources | Invoices/items, credits, original all-in/net/tax/discount components, accepted scope/completion linkage and immutable customer presentation |
| Money sources | Receipts, root/descendant partitions, allocations/unapplications, tips, funds, refunds/failures/recoveries, transfers/fees/equity and external identities |
| Purchases | Vendors, splits, business/personal/funding, supplier refunds/AP settlements, receipt originals or missing-receipt reason; prepaid schedules if used |
| Reconciliation | Statements/rows/matches, outstanding timing items, opening bridges, equations, approvals/invalidations and account identifiers masked as appropriate |
| Mileage | Actual/estimated separation, purpose/vehicle/date/distance/source and job attribution, no automatic deduction |
| Asset schedule | Cost/source/in-service/method/life/basis/depreciation/disposal, or explicit not activated/unassessed warning |
| Opening package | Approved cutover plan, actual balances and item details, equity derivation, unknown/verified status, supporting evidence and subsequent corrections |
| Configuration/audit | Chart/report roles, mapping/tax/policy versions and approval evidence, exception register, corrections, lock/unlock/import/export/restore histories |
| Manifest | Schema/dictionary, stable join IDs, file counts, exact cents/USD, checksums, null/escape/date rules, snapshot/generation, attachment inventory/completeness |

XLSX tabs: Read Me, Coverage, Controls, Chart, Trial Balance, GL, P&L, Balance Sheet, AR Aging, Customer Funds, Payables, Invoices, Credits, Receipts, Allocations, Tips, Refunds, Transfers, Expenses, Reconciliation, Opening, Mileage, Assets (if used), Policies and Corrections; split oversized detail per existing export limits. CSV exports every implemented normalized entity, not just report summaries. PDF reports include date basis, source totals, warnings and page numbering. Original evidence bytes accompany manifest in secure downloadable parts; expiring links alone do not qualify. Exclude auth tokens/credential hashes/secrets. Exact integer cents and immutable IDs survive roundtrip. Accountant access uses explicit user sharing/export; no new public portal.

## 19. Required synthetic posting examples

All amounts in this section are **USD dollars displayed to two decimals**, stored as integer cents. All use a verified synthetic non-taxable profile unless explicitly synthetic10%. These are not real Crest transactions. Each numbered example is independently seeded except the stated continuation. Every journal below balances individually; multi-step operations must also meet the transactional boundaries specified. "Correct" column specifies later correction behavior, not an instruction to change real books.

| Example / source event | Debit | Credit | Subledger change and control check | Later correction behavior |
|---|---|---|---|---|
| E01 Completed450 invoice, P01 | AR450.00 | SR450.00 | Invoice charge450; AR450; scope consumed once | Correcting credit; no deletion/rebilling without linked consumption release |
| E02 Gross500 less50 discount invoice, P01 | AR450.00; D50.00 | SR500.00 | AR450; net service450; stored discount50 | Full credit DrR500 CrAR450 CrD50; partial uses original proportions |
| E03 Full450 receipt on E01, P03 | Bank450.00 | AR450.00 | Root450 allocated; invoice/AR0; SR unchanged450 | Failure DrAR450 Cractual money450; real concession uses E08 |
| E04a Partial200 receipt, P03 | Bank200.00 | AR200.00 | Invoice450→250; root200 | Reverse remaining selected root only |
| E04b Later250 receipt, P03 | Bank250.00 | AR250.00 | Invoice250→0; two roots total450; revenue still450 | Correct second receipt without rewriting first |
| E05 Receipt475 with confirmed25 tip, P03 | Cash475.00 | AR450.00; TR25.00 | Root partitions450 application/25 tip; AR0; tips25 | Tip refund DrTR25 CrCash25; service refund separate |
| E06 Receipt475 with unidentified25 excess, P03 | Cash475.00 | AR450.00; F25.00 | Root450 applied/25 held; AR0; funds liability25 | Reclass only after intent; never automatic TR |
| E07 Return E06 excess25, P09 | F25.00 | Cash25.00 | Funds0; root returned25; net cash450; service450 unchanged | Erroneous record/recovered return DrCash25 CrF25 with same slices/evidence |
| E08a Paid450 invoice, approve100 concession: unapply, P05 | AR100.00 | F100.00 | Application450→350; root funds100; temporary AR100 inside transaction | Atomic with E08b; rollback both if either fails |
| E08b Concession100, P07 | R100.00 | AR100.00 | Charge450→350; active allocation350; AR0; net service350 | Reverse erroneous credit only with authorized charge; funds reapply if held |
| E08c Confirm actual100 service refund, P08 | F100.00 | Bank100.00 | Funds0; root applied350/returned100; bank net350; AR0 | Recovery restores F, not service revenue; credit remains |
| E09a Receive check450, P03 | Checks450.00 | AR450.00 | Held-check450; invoice0; root450 | If erroneous no deposit, reverse Checks; if deposited follow next rows |
| E09b Deposit clears same day, P19 | Bank450.00 | Checks450.00 | Checks0, bank450; original receipt root unchanged | Wrong deposit classification corrects transfer, not receipt |
| E09c Bank dishonors450, P11 | AR450.00 | Bank450.00 | AR reopened450; root failed450; SR stays450; bank0 | If later recovered, new confirmed receipt can settle debt; do not erase dishonor |
| E10 Transfer500 Venmo less10 confirmed fee, P19 | Bank490.00; Fees10.00 | Venmo500.00 | Venmo−500/bank+490; source fee10; no revenue; statement net490 | Correct erroneous fee/transfer with evidence; actual returned transfer new event |
| E11 Paid100 supplies expense, P12 | Supplies100.00 | Bank100.00 | Reviewed expense100; bank movement−100; AR/F unchanged | Reclass expense without cash, or reverse erroneous source |
| E12 Owner personally pays100 supplies, P13 | Supplies100.00 | OC100.00 | Expense100/equity+100; business bank unchanged | Correct funding explicitly; later withdrawal is not duplicate expense |
| E13 Owner contributes500, P21 | Bank500.00 | OC500.00 | Bank+500/equity+500; revenue0 | Actual repayment uses draw unless correction proves original wrong |
| E14 Owner draws100, P22 | OD100.00 | Bank100.00 | Equity−100/bank−100; expense0 | Wrong classification needs documented reclassification, no hidden expense |
| E15 Inclusive110 at SYNTHETIC10%, P01 | AR110.00 | SR100.00; TX10.00 | Original N100/t10, AR110; profile frozen | Credits consume original100/10, never current rate |
| E16a Credit10 of E15, P07 | R9.09; TX0.91 | AR10.00 | Remaining AR100, original net remaining90.91/tax9.09 | Reverse exact9.09/0.91 if erroneous |
| E16b Credit remaining100, P07 | R90.91; TX9.09 | AR100.00 | AR0; cumulative credited net100/tax10; no residual | Full restoration uses exact original slices, not recalculation |
| E16c Alternative full110 credit (fresh E15), P07 | R100.00; TX10.00 | AR110.00 | AR0; cumulative net100/tax10 | Same original-profile restoration; don't apply after E16a+b |
| E17 Opening receivable300, P27 | AR300.00 | Opening equity300.00 | Opening item300/due-date evidence; no invoice revenue or scope | Wrong opening balance uses linked opening correction; later collection DrBank300 CrAR300 |
| E18 Opening customer funds75, P27 | Opening equity75.00 | F75.00 | Opening root75 held, refundable capacity supported; no new bank receipt | Correct opening with evidence; real return DrF75 CrBank75 |
| E19 Supplier returns20 of E11, P16 | Bank20.00 | Supplies20.00 | Cost remaining80; refund cap80; bank net−80; no SR | Erroneous refund reverse original components; actual supplier repayment separate linked movement |
| E20 Asset purchase1200 NON-POLICY example, P23 | Equipment1200.00 | Bank1200.00 | Asset cost schedule1200; no immediate expense; no tax election inferred | Wrong classification linked correction; no automatic depreciation |

Additional adversarial fixtures make the less obvious semantics reviewable:

| Example / source | Debit | Credit | Required result / correction |
|---|---|---|---|
| E21 E06 held25 becomes confirmed tip | F25.00 | TR25.00 | Same root25 now tip; later DrTR25 CrCash25 consumes it once |
| E22 Paid discounted E02 gets90 concession | First AR90.00; then R100.00 | First F90.00; then AR90.00 and D10.00 | Atomic unapply+credit; SR500−D40−R100=360; applied360, funds90; refund separately |
| E23 Receipt300 across two invoices200/100 | Bank300.00 | AR itemA200.00; AR itemB100.00 | Same customer, two items, one root300; no double receipt |
| E24 Transfer500 dispatch then490 arrival next day with10 fee | Day1 Transit500.00; day2 Bank490.00 and Fees10.00 | Day1 Venmo500.00; day2 Transit500.00 | Day1 transit500; day2 transit0; no premature bank cash |
| E25 Business-paid100 purchase,70 business/30 personal | Supplies70.00; OD30.00 | Bank100.00 | Expense70 only; receipt100; reclassification keeps actual money |
| E26 Gross110 supplies receipt includes10 nonrecoverable purchase tax | Supplies110.00 | Bank110.00 | Tax metadata10 is inside110; never expense120; recovery policy not assumed |
| E27 Incur100 unpaid supplies then pay40 | First Supplies100.00; then AP40.00 | First AP100.00; then Bank40.00 | AP remaining60; expense100 once; supplier-credit later caps60 unpaid |
| E28 Literal zero-price complimentary invoice | None | None | Verified zero event; consumes scope identity; no invented receipt or zero journal |
| E29 Gross100 fully discounted complimentary invoice | D100.00 | SR100.00 | AR0/net revenue0; preserves gross/discount; scope consumed; credit cash cap0 |
| E30 Asset example E20, adviser-approved manual100 depreciation | Depreciation100.00 | Accumulated depreciation100.00 | Cost1200/AD100/carry1100; no threshold/method policy implied |
| E31 Dispose E30 asset for1000, synthetic non-taxable | Bank1000.00; AD100.00; Loss100.00 | Equipment1200.00 | Cost/AD register0; loss100; disposal once; true proceeds not service sales |
| E32 Synthetic opening bundle: bank1000,AR300,F75,AP125 | Bank1000.00; AR300.00 | F75.00; AP125.00; Opening equity1100.00 | Assets1300=liabilities200+equity1100; evidence must establish all components; no P&L |
| E33 Real check450 refunded100 before full bank clawback450 | Surviving AR350.00; unresolved outflow clearing100.00 | Bank450.00 | Earlier100 service concession stays; no fictitious450 AR; suspense100 investigated; full refund+failure root cap not breached |

E33 assumes E08-style concession/refund already reduced original service charge to350, then provider removed full450; original root had350 live and100 returned. Post P11 for350 plus P33 for100 as explicitly linked exceptional debit. This is a qualified unresolved loss/recovery case, not proof that100 is collectible from the customer.

## 20. Adversarial accounting review and incorporated corrections

Counterfactual: after two years every journal balances but the books are materially wrong. This is a design self-review, not a second independent professional audit. Each row names a concrete failure, the strengthened rule, enforcement and required regression. All protections are incorporated above; passing implementation tests remains future work.

| Risk / balanced-but-wrong failure | Prevention and incorporated correction | Enforcement / automated test |
|---|---|---|
| Wrong account classification maps SR to equity/other income | §3 role/type/control validation; report roles frozen | C07/C09; inject balanced wrong-account template and reject |
| Receipt recognizes service revenue twice | P03 credits AR, only P01 issues SR | C07; E01+E03 revenue450 not900 |
| Missing earned billing yields apparent low revenue | Completed-unbilled queue, qualified close/report; no silent accrual invention | C19/C20; completed scope missing invoice stays exception, not zero value |
| Same receipt entered manually twice under new key | Unified external registry and reviewed ambiguous duplicates | C14/C15; manual+CSV replay, distinct identical cash fixture |
| Same CSV money imported in reformatted/overlapping export | Match existing source registry before new posting; file hash alone insufficient | C02/C14; overlapping file different row numbers yields one movement |
| Transfer treated as sale on bank arrival | P17-19, two-leg identity/transit | C08; E24 across month end, bank row cannot become receipt |
| Confirmed tip recorded as service | Separate tip realization/account and intent | C07; E05 and standalone tip show4100 only |
| Overpayment treated as tip/revenue | F unless explicit intent; unknown payer2390 | C04/C11; E06 shows25 liability even with invoice settled |
| Refund treated as failed collection | P07+P08 reduce charge and cash, not restore debt | C03/C06; E08 leaves AR0 |
| Failure treated as concession | P11 reopens surviving AR, not SR | C03/C07; E09 leaves SR450 |
| Service credit on paid invoice makes negative AR or debt reappear | Atomic minimum unapplication+credit | C03/C05; crash between E08a/b rolls back; later refund AR0 |
| Discount double counted on partial credits | Gross return and proportional discount reversal fixed | C18; E22 net service360, not350/370 |
| Tax partial credits drift by pennies | Original-offset prefix differences, restored holes and terminal residual | C18; thousands of one-cent credit sequences sum original tax/net |
| Historical tax/config drift changes old sale | Frozen original profile and account mappings | C11/C12; change current rate/account then credit E15, still original100/10 |
| Owner-funded purchase credited business bank | Explicit funding kind, business-only owner portion | C09; E12 bank unchanged and equity+100 |
| Owner draw booked as expense | Typed equity event, no P&L side | C09; E14 net income unchanged |
| Missing openings masked by equity plug | Verified/unknown per account; evidence and detail tie-out | C16; unknown bank cannot approve complete opening or complete BS |
| Wrong cutoff/date double counts legacy cash or AR | Boundary roster, reference-only history, opening remaining balances | C16; prior receipt never replayed after E17/E18 |
| Wallet cash never reconciled, deposits falsely banked | Separate account per wallet and timing/transit detail | C08/C17; bank and wallet each reconcile, in-transit displayed |
| Manual journal changes AR without invoice | Control-write restriction and typed subledger movement | C10; balanced direct-control journal rejected |
| Posted history edited/deleted through admin UI/archive | Immutable guards, archive not report filter | C12; direct SQL/UI mutation denied; archived account retained in TB |
| Concurrent devices spend same funds/refund capacity | Finance serialization plus deferred caps | C04-06; two connections attempt final25; only one consumption |
| Network retry posts again | Stable operation+source identity, uncertain outcome recovery | C02; disconnect after commit returns original IDs/date |
| Import replay creates new source numbers | Approved batch hash/row IDs and source registry | C02/C14; exact and overlapping replays do not allocate numbers |
| Restore reuses issued invoice number or repeats external refund | External recovery evidence, number reservations, no automatic provider replay | C21; restore before later issued/refunded events, reopen blocked until reconciled |
| Original receipt cap ignores reclassified funds/tips | Root/descendant conservation, not only initial payment component | C04/C06; apply→unapply→tip→refund→failure cannot consume twice |
| Opening funds cannot refund because no payment row | Opening funding-origin alternative | C16/C06; E18 refund traceable to opening evidence without fake receipt |
| Deposited check failure credits now-empty Checks | Actual later debit account, original chain preserved | C03/C17; E09 Checks0, Bank0, AR450 |
| Full failure after real partial refund invents debt/reverses refund | Surviving component failure plus explained exceptional debit | C06/C22; E33 AR350, suspense100, real bank−450 |
| Year2 equity adds year1 earnings twice | No automatic closing journal; cumulative derived earnings once | C20; two-year P&L/BS tie with prior/current split |
| Current Reversed status hides original from prior-period report | Include original and correction by effective dates | C12/C20; January receipt reversed February still present January |
| Balanced opening AR has wrong customer/item | Per-customer/item controls and typed receivable parent | C03/C16; swapping two equal customer balances is caught |
| Reconciliation balance zero hides unmatched positive/negative rows | Require all rows matched or exact evidenced timing; no arbitrary netting | C17; equal unrecorded inflow/outflow cannot clear merely net0 |
| Late backdating makes earlier funds negative | Replay affected chronological event boundaries | C05/C13; today's positive total cannot permit invalid historical refund |
| Gross fee-net settlement silently reduces customer payment | Preserve gross receipt and separately sourced fee | C07/C17;475 gross/10 fee =>465 wallet, not AR left10 |
| Fully discounted work skipped/rebilled | Gross/discount journal plus scope identity even at zero price | C19; E28/E29 each consumes once, literal zero event only E28 |
| Purchase-tax component added twice / supplier refund as revenue | Receipt gross partition and original cost reversal | C22; E26 debit110 not120; E19 SR0 |
| Backup health override disables accounting integrity check | Distinct backup-age permission versus control-mismatch stop | C01/C03; stale backup permits valid posting, TB mismatch blocks it |

Residual risks: owner can misdescribe genuine events or omit cash; matching cannot prove a cash receipt existed; adviser decisions can be wrong; all privileged credentials compromised together can defeat controls; evidence may be unavailable after a backup loss window. Independent statements, source review, counts, exports and recoverable backups reduce these risks. The software must expose uncertainties, not certify economic truth from balanced journals alone.

## 21. Remaining decisions and implementation readiness

### A. May remain configuration until the feature is used

Current bank/wallet labels; additional named accounts; optional detailed service revenue accounts (not needed by this chart); owner-selected due-date override; job cost allocation choices; optional asset register UI; payment-provider additions; optional payable/debt/prepaid mappings; reporting book-year label. No feature may silently activate its unresolved mapping. Conditional financial sources require the corresponding evidence before their first real use.

### B. Must be resolved before accounting engine implementation

No unresolved Indiana tax rate, real opening amount or personal business-policy answer is required to build the synthetic engine. **This financial contract, section26 owner custody and X01-X28 companion corrections are adopted as the implementation baseline**, including root/descendant lineage, opening receivable parent, original-offset range credit/restoration algorithm, statement timing items, actual-account dishonor, monthly book periods and derived earnings. These are adopted technical/accounting decisions, not matters an engineer may choose independently. If owner/adviser rejects one, revise its affected templates/tests before implementing it. Confirm the exact current canonical document set when creating the repository; don't implement an older unamended package.

### C. Before real financial production activation

| Gate | Owner/adviser decision or evidence | What remains blocked |
|---|---|---|
| D01 | Verified service/tip/exemption/tax dates/rates/presentation/rounding, historical credit treatment and purchase tax when applicable | Affected real invoice/tip/credit/asset-disposal tax posting |
| D02 | Adopt chart, map actual business accounts, approve ownership/funding choices and documented opening completeness | Primary financial launch; complete financial statements |
| D03 | Resolve actual asset classification/basis and any used book depreciation/prepaids; adviser handles tax method/elections separately | Unresolved individual asset/cost posting and claims of complete valuation; not synthetic engine or ordinary verified supplies |
| D12 | Select exact cutover date/time and per-balance plan, remaining AR/funds/debts/assets, reference-only legacy records and reviewed equity bridge | Cutover/openings and sole-system reliance |
| D10/D11 | Existing tested backup/restore, key custody, alert delivery, auth/recovery and security gates; measured budget capacity | Any real-data pilot, unchanged by this specification |

Accountant review of this contract's real configurations is strongly recommended before using it as sole books, but the document does not claim CPA review has occurred. No default tax status, owner-loan status, asset threshold, depreciation election, actual balance or cutoff date is invented to clear a gate.

**Readiness decision:** Yes-Crest OS is ready to proceed to repository creation and implementation planning with this adopted contract and incorporated corrections. Financial code must use the adopted contract and synthetic fixtures, not the older deferred placeholders. Production is not ready: verified business configuration, actual openings, implemented tests, security/recovery proofs and pilot reconciliation remain required. This task itself authorizes and supplies specification work only; it creates no repository or application.

## 22. Cross-document review and smallest necessary corrections

All X01-X19 below apply and are adopted in the current canonical files. This retained provenance table describes the pre-reconciliation defect and its incorporated correction; it is not deferred work. The companion bodies contain the binding rules without requiring this matrix. X20-X28 are recorded in24.12.

| ID / document and section | Finding | Smallest required correction / governing section here |
|---|---|---|
| X01 PRODUCT P15, §5 D02/D03 | Opening/asset policy wording can imply tax elections block whole engine | Reference ACCOUNTING §§1/21; distinguish synthetic implementation, per-feature classification and real launch. Keep asset UI optional and all existing release gates |
| X02 BUSINESS_RULES BR11.3, BR12.3 failed-payment row | "Original asset" is wrong for a deposited check later debited by bank | Say erroneous entry reverses recorded account; actual later dishonor credits actually debited account, with original chain and unchanged earned revenue (§4.4/E09) |
| X03 BUSINESS_RULES BR11.2-3 / BR12.3 | Initial payment components insufficient after application/unapplication/tip conversion and opening funds | Define funding origins and descendant capacities, exact corrective restorations, approved opening roots and exceptional post-refund bank debit (§4.3-4.4); retain refund ceiling |
| X04 BUSINESS_RULES BR12.2-3 | Partial credit/discount rounding allows differing implementations | Adopt original-offset range/prefix allocation including exact non-last reversals, original tax, proportional discount reversal and terminal residual (§7/§24.1); literal-zero vs fully discounted invoice distinction (§5) |
| X05 BUSINESS_RULES BR14 financial reports | "Exclude reversed effects" could hide original in earlier period; earnings not mechanically defined | Include each posted original/reversal by its own effective date; derived cumulative earnings once, no auto annual close (§13) |
| X06 DATABASE §7 payments/components/funds/refunds | Fund-lot source_payment_component required and refund original_payment_component required conflict with openings; reclassified tips lack typed realization | Add funding_origins XOR receipt/opening/unidentified-inflow/legacy-settlement, origin partitions/movement links, tip_realizations and consumed-component lineage; funds/refunds reference descendants. Store initial receipt component as provenance, not sole capacity authority (§4.3/§24.6) |
| X07 DATABASE §7 allocations/credits/opening_items | Invoice-only FKs cannot collect/credit opening AR or later legacy failure without fake invoice | Add receivable_items XOR invoice/opening-AR/legacy-failure; allocations/credit items reference it; original metadata and remaining tax details retained (§12.2/§24.6) |
| X08 DATABASE §7 transfers | Single event/date cannot express settlement across dates | Add transfer_legs and transit_lots with departed/arrived/returned components, effective dates, original principal/fee evidence and remaining bounds (§6) |
| X09 DATABASE §7 reconciliations/matches | No explicit timing-item carryforward or overlap-wide match capacity | Add outstanding_timing_items tied to money/opening movement, clearance links, immutable statement revision/interval, amount allocation across reconciliations and generation invalidation (§10) |
| X10 DATABASE §7 finance tables | Minimal AP/debt/asset/tax/prepaid/suspense control details missing | Add typed payable_items/movements, debt/owner obligations, other receivable claims, asset_cost/depreciation/disposal events when activated, tax movements, prepaid schedules, suspense items and unidentified inflow origins; all composite FKs/immutable events (§§2/4/8/9) |
| X11 DATABASE §7 accounts/mappings/journals; §2 finance_controls | Account types alone cannot constrain report roles; backdated checks/zero-value billing and correction DAG underspecified | Add immutable report/control roles, unique effective mapping intervals, chronology/correction links and entry ordering; enforce zero-dollar scope consumption uniqueness. Root account identity registry shared across sources (§§3-5/11) |
| X12 DATABASE §8 cutover_plans/external identities | Date-only boundary insufficient for explicit cutover time; source-specific identities miss cross-type duplicates | Add exact cutover instant/zone/sequence, verified/unknown balances and evidence hash; unify provider movement registry + statement aliases; invoice-number reservations and recovery epochs (§§6/12) |
| X13 ARCHITECTURE §§1/4/10, ADR21 | Says final accounting semantics intentionally deferred | Reference adopted ACCOUNTING template/control contract and X06-X12. Preserve monolith/transaction/finance lock and all provider selections |
| X14 SECURITY §§3/4/8 | Generic finance capability needs constraints for new typed corrections/close | Extend allowlisted commands/grant-abuse tests to new control types and correction chains; retain recent-auth unlock and no generic control writes. No authentication redesign |
| X15 TESTING F5, T14-T22/T27-T29/T34-T36, §4 | Existing fixtures do not cover roots/openings/transit/year2 earnings/dated reversals | Add E01-E33/C01-C22 and §20 adversarial sequences, original-map credit tests and chronology replay. Tests remain implementation gates, not claimed passes |
| X16 EXPORTS_AND_BACKUPS §§2/3/5/7 | Complete export/restore must include new lineage/control/number-reservation structures | Include new normalized entities, exact component slices and opening/timing schedules; restore every control per customer/root/account; all identity tombstones and externally issued number reservations (§§12/18) |
| X17 ROADMAP phases0/8-12 | Phase0 no longer lacks templates; migration sequencing needs shared origins/items before collections | Mark contract adopted; require typed origins/receivable-items/control schedules in finance foundation before billing/refunds/imports. No extra infrastructure or feature phase |
| X18 ARCHITECTURE_DECISIONS ADR21, D01-D03/D12 | Deferred semantics and owner inputs outdated after this phase | Link contract; mark design adopted but real configuration evidence outstanding. Do not mark real tax/openings approved |
| X19 ARCHITECTURE_REVIEW R05/R11/R26/R27 and Disposition | Accounting design gap now specified; new failure scenarios need traceability | Link §20, identify incorporated controls and residual limits; readiness becomes planning/synthetic implementation after adoption, never production certification |

Other reviewed requirements remain unchanged: accepted quote history, review-at-completion workflow, customer/vehicle identity, work/custody/mileage, manual sharing, owner authentication, no card credentials, dollar budget target, six-hour backups with 30 daily/12 month-end points, continued writes during backup-age breach, and staged contact-only Urable import. No real customer/account data is requested for development. No automatic suspense, tax assumption or retrospective revenue import is introduced.

## 23. Initial version 1.0 verification record and acceptance handoff

Document review checks performed in this phase: required sections1-18; all20 required example families plus additional edge fixtures; source-template/control/report linkage; current owner amendments; adversarial scenarios and ten-document correction coverage. Executed exact-integer specification checks passed for all40 displayed journal rows and74,569 cumulative credit boundaries across11 synthetic original amounts, including one-cent credits, monotonic net/tax capacity and exact terminal totals. Coverage checks found23 numbered sections,33 example families,38 posting templates,22 controls and19 cross-document correction items; UTF-8 text passed replacement-character inspection. These checks validate specification math/coverage only, not software behavior or tax legality. Engine concurrency, DB triggers, permissions, restore, exports and real-device tests have not run because no application was built.

Implementation acceptance must compare full posted account/component/dimension/date effects to the examples, not simply balanced totals. Generate randomized valid and invalid sequences for roots, original tax slices, credits, returns, failures, corrections and locks. After every commit assert all control equalities and historical nonnegativity. On rejected commands assert no source/journal/audit-success/number reservation partially committed. Retain meaningful failed-attempt operational logs without claiming a posted financial audit event.

The initial verification above is retained as a historical specification-arithmetic record, not rerun software evidence. The final adoption package includes all reconciled companion documents and the adoption report; original synced/project input copies remain preserved.

## 24. Final adversarial review - corrected executable accounting decisions

The final adversarial review retained in canonical version1.4 subjects the prior design to a new failure-oriented review against PRODUCT P11-P17, BUSINESS_RULES BR00/BR06/BR11-BR17, ARCHITECTURE §§4-5, DATABASE §§7-8, TESTING F5/T10-T22/T27-T36 and ARCHITECTURE_REVIEW R05-R07/R11/R26-R29. This is a separate review pass by the same assistant, not a claim of independent CPA or third-party certification. The following are **normative corrections**, not optional suggestions. Related original sections were corrected above; this section supplies exact additional transitions, prohibitions and fixtures. No existing business/tax policy gate is treated as approved.

### 24.1 Reversed-credit rounding and terminal invoice status

**F01 - High: net cumulative credit amount is not enough after exact reversals.** Synthetic inclusive6 cents at10% yields net5/tax1. Credit3 cents (net3/tax0), then1 cent (net0/tax1); reverse the first3-cent credit. Live credit is now1 cent with net0/tax1. Recomputing a new1-cent credit from the total live credited amount2 gives cumulative net2/tax0; subtracting actual retained components demands net2/tax−1. Balanced totals would not make that valid. Original-offset range consumption in §7 fixes this, including tip refunds/failures and discount reversals. New credit consumes restored original offset1: net1/tax0, never negative tax. Tests must reverse non-last credits, not only add sequential credits.

Restoring a credit restores its original charge offsets and changes the derived invoice lifecycle. An invoice fully corrected and then validly restored must derive Issued (or partially corrected), not remain permanently Reversed. Retain all lifecycle events; never mutate issued fields. `charge_remaining` is original amount less **net currently consumed credit offsets**, not sum of all historical credits ignoring restorations. Zero-valued gross/discount corrections use a unique nonmonetary entitlement and exact reversal, not arbitrary repeated DrSR/CrD. For invoice credit reversal with an already-transferred replacement entitlement, reject until the replacement chain is atomically unwound or otherwise corrected without double billing. A full credit is not proof the work may be sold again.

### 24.2 Separate recognition, funding and refund-entitlement dates

**F02 - High: a now-paid expense could credit bank on its earlier incurred date.** Explicit conventions:

| Case | Required entries and dates |
|---|---|
| Supplies incurred Jan31, paid Feb2 | Jan31 Dr5000/Cr2200; Feb2 Dr2200/Crbank; never credit bank Jan31 |
| Same-date purchase/payment | P12 combined entry allowed |
| Owner pays Jan31 business cost on Feb2 | Jan31 Dr expense/CrAP; Feb2 DrAP/CrOC, or Cr2350 only if an actual reimbursement obligation was chosen; no business-bank line |
| Owner prepays future business benefit | At owner payment Dr1150/CrOC (or2350); at reviewed benefit date Dr expense/Cr1150 |
| Supplier establishes unconditional refund claim Jan31, pays Feb2 | Jan31 Dr1120/Cr remaining reviewed cost/tax; Feb2 Drbank/Cr1120; do not wait until cash for a known earned refund claim |
| Supplier refund not approved/unconditional yet | Retain pending claim evidence, no asset invented; post when entitlement becomes evidenced |
| Loan-funded purchase or interest expense paid later | Recognize acquisition/expense and genuine obligation first; actual principal/interest money movement has its own date; no later payment date used to shift expense |

Multiple dated entries may be entered atomically after the fact, but **each event preserves its own truthful effective date**, except the explicitly adopted locked-period correction treatment. "All correction entries share a date" applies to reversing/replacing one accounting error, not combining economically separate accrual/payment events. Each date's period and chronological prerequisites must validate. If an earlier required date is locked, stop for §11's explicit correction direction rather than silently move cash or expense. Pure supplier-tax/legal treatment remains D01/D03-gated.

### 24.3 Refund failure, receipt failure, tip reclassification and recovery

**F03 - High: automatically reversing a failed tip refund would re-recognize revenue even though Crest still owes the customer.** Receipt failures and outbound-refund failures are distinct source kinds. A valid tip refund25 posts DrTR25 Crbank25. If the provider returns that failed transfer25, post Drbank25 CrF25, with the same funding origin now in `tip_return_due`; tips stay reduced and the customer is still owed25. A second confirmed outgoing payment is DrF25 Crbank25, not another DrTR. For service/excess returns the same failed-outbound recovery restores F and preserves any service credit. External returned-payment fees remain separate fee components and do not reduce what Crest owes unless a separate valid charge reduction is established. For failed refund gross100 with provider-retained fee5 and actual net recredit95: DrM95 + DrFees5 / CrF100, restoring100 of the original returned ranges. One net95 evidence envelope includes the embedded fee exactly once. If provider instead credits100 then debits5 separately, DrM100/CrF100 and DrFees5/CrM5 with distinct evidenced movements. Apply section26 personal-funding rules for any actual debit shortfall; never restore only95 of liability merely because the net deposit is95.

**Tip classification correction:** if an original recorded tip was actually excess with no tip intent, append DrTR original net + DrTX original tax / CrF gross, linking original tip ranges, customer and evidence. It consumes the tip realization's retained ranges into funds but does not consume root money or change cash. A later funds refund is DrF/CrM. Conversely P06 requires affirmative customer intent. Correcting tip→funds back to tip reuses the same restored original tax ranges only when correcting an erroneous reclassification; a genuinely new tip decision resolves a new verified profile on the new realization date. No automatic tip recognition on returning money or on reducing an invoice charge.

**Receipt failure recredit:** a provider that reverses a failed receipt later may credit money back. Require external linkage and reviewed current disposition. If restoring the same previously failed source, move exactly selected failed root ranges back into live partitions, Dractual M; CrAR only for still-valid outstanding original descendant charges, CrF for amounts no longer due, and CrTR/TX only for valid restored original tip intent. For reinstated original tips use the original ranges/profile; unresolved intent puts money in F. Recovered failure amount cannot exceed that failure's still-unrecovered amount. This is not a fresh root plus restored root simultaneously. A genuinely new payment from the customer is instead P03 with a new identity; the prior failure stays failed. Both cases preserve source attribution and never reverse earned SR on collection failure.

Actual service/excess/tip refunds may use a different business money account from the original receipt with evidence; root capacity follows the money origin, not the bank-account balance. Never permit cross-customer application, tip reclassification or refund recipient change through ordinary operations. A documented payee authorization may identify an agent receiving money on behalf of the same customer, but it cannot change the liability's customer identity. Correcting a wrongly assigned customer requires atomically unapplying affected allocations, reversing erroneous tip classification if needed, and reattributing remaining held funds using DrF(old customer)/CrF(correct customer) with the same root and evidence; already-returned money requires a reviewed recovery exception, not retroactive counterparty rewriting.

### 24.4 Unknown money, suspense and external settlement identity

**F04 - High: unknown deposits are not necessarily customer payments.** P35/2390 is an unidentified-inflow control. Resolve without moving cash again:

| Proven cause of unidentified inflow | Debit | Credit / required detail |
|---|---|---|
| Customer payment |2390|2000 same root, then explicit application/tip classification |
| Owner contribution |2390|3100, owner funding evidence; terminal noncustomer disposition |
| Borrowing |2390|2300, named debt item; terminal noncustomer disposition |
| Transfer arrival already dispatched |2390|1060, matched transit lot; terminal noncustomer disposition |
| Same-day transfer whose origin leg is missing | First origin account to1060 as P17; then2390|1060 after evidenced dispatch; no automatic owner contribution |
| Supplier refund with existing claim |2390|1120 claim settlement; no second expense credit |
| Supplier refund with no prior claim |2390|Remaining reviewed cost/tax classification under P16 |
| Confirmed bank interest/other supported non-service income |2390|4200 with approved source classification |
| Proven mistaken incoming transfer returned externally |2390|Actual M; root net-returned, not noncustomer-resolved plus returned |

Required mappings/typed controls still apply. Classification selects no journal accounts from free text. Uncertainty remains2390 and visible; it does not automatically become revenue when old. A correction to terminal classification reverses that typed source and capacity before another classification; a known owner contribution cannot later be refunded as customer funds without that correction.

P33/1190 similarly resolves by actual cause: Dr approved expense/asset/OD or DrAP/debt-principal/tax-payable for a documented settlement / Cr1190. A transfer dispatch incorrectly held in1190 resolves Dr1060/Cr1190 with the missing transit lot, then normal arrival. If the evidence instead proves an actual banking error has been reversed, DrM/Cr1190 closes the item. Unsupported recoverable debt is not silently created. Unresolved suspense is shown separately from verified assets and from reliable income; clean close is blocked. A qualified administrative lock may preserve an incomplete period, but cannot label it reconciled/complete or waive control equality. Unknown incoming funds likewise prohibit a completeness claim while their economic classification could change the statements.

**F05 - High: one provider settlement can contain a receipt and a fee; treating each as a separate unique provider transaction either duplicates money or rejects valid components.** Define one immutable `external_money_evidence` envelope per provider/account/verified transaction identity. It can reference several typed economic components, but one signed account movement or explicitly evidenced gross/fee movement set. Preserve original total, currency, direction and sign. All component movements sum exactly to the envelope amount. A statement row matches this envelope or its exact disjoint movement allocations. A net475 receipt less10 fee has465 wallet increase and10 expense once, not465 plus another gross475 receipt. Batch settlements have their own identity and documented child transaction IDs; a batch ID cannot substitute for individual customer receipt identity. Identity uniqueness is not scoped by a user-chosen event type; one bank ID cannot be inserted again by choosing owner contribution instead of receipt. Provider-documented distinct ID namespaces remain explicit metadata.

Statement imports normalize pending/booked/reversed states explicitly. Pending statements do not create confirmed movements. Repeated source files alias to existing canonical statement transactions, including overlapping date exports. Exact provider identity identifies the transaction; fingerprints only suggest a match. Equal amounts with distinct verified IDs remain legitimate. Reconciliation/exclusion cannot remove a real account transaction because its category is inconvenient. Personal movement in a business account is still an owner/economic transaction, not an ignored statement row. A missing original record discovered on import invokes the normal typed command with the same envelope identity.

### 24.5 Account/cost classification, fees and owner payments

**F06 - High: migrating a control balance while reversing future credits to the original account breaks per-item controls.** Used control remapping is disabled in V1 (§3). New payments to an invoice use that item's pinned AR, and funds use pinned liability controls. No engineer-selected reclassification migration. Revenue/expense mappings may change for new sources, but original invoice/credit accounts stay frozen. Account type/control/report-role changes after use are forbidden; correcting a mistaken classification is a source-linked posting.

**F07 - High: supplier refund against original expense after capitalization would reduce expense while leaving refunded asset cost on the balance sheet.** Preserve cost-origin ranges and their current accounting destinations through capitalization/prepaid releases/reclassification. A supplier refund consumes named remaining original cost ranges and credits their **current valid book classification** with original purchase-tax provenance, not blindly the first expense account. For a fully expensed cost no later reclassification, P16 remains unchanged. For a depreciated/disposed/mixed-use asset or partly released prepaid, require an adviser-reviewed per-component adjustment plan: explicit reduction of asset basis, accumulated depreciation, expense/recovery and recoverable tax as applicable; totals must equal actual supplier credit/refund. No automatic formula or fallback is authorized when basis treatment is uncertain. This existing D03 gate blocks only that exceptional posting; its actual cash may be held under2390 pending reviewed resolution. The engine supplies exact typed component validation, not a guessed capitalization/depreciation policy.

Owner-funded expense examples use contribution only when explicitly selected; no default is inferred. Section26 determines custody versus personal funding. A supplier refund arriving in a mixed personal channel first increases business custody and reverses the reviewed cost/settles1120. If contemporaneously retained to settle a still-unpaid2350 obligation, append Dr2350/Cr custody capped by that obligation. If explicitly returned contributed capital, append Dr3100/Cr custody only up to the supported original contribution chain, otherwise an explicitly approved distribution uses3200. An already-reimbursed obligation cannot be reduced again. All dependent same-date source/settlement components commit atomically and the external envelope is recorded once. A refund to business bank increases that bank; the contribution remains until an explicit supported owner event. No fictitious business-bank movement or double supplier refund.

Manual P36 cannot serve as a free-form account chooser for current revenue, refunds, customer money, owner cash, tax, assets, AP or debt. Expense reclassification must reference specific remaining cost ranges, preserve business/personal classification and update source report dimensions. Adviser-directed noncash equity/expense adjustments use a distinct approved adjustment source, policy version, exact amount/account plan and supporting schedule, and appear in the expense/P&L bridge. They cannot "close" balances or substitute for unsupported purchase evidence. All money/control lines require their typed source; a balanced generic entry with one allowed non-control line cannot bypass this through its counterpart.

### 24.6 Cutover: older paid transactions can still be refunded or fail

**F08 - High: opening AR and opening funds alone omit refund/failure provenance for already-paid pre-cutover invoices.** Prospectively starting books does not extinguish those obligations. Permit a narrowly reviewed **nonposting legacy settlement reference**, not historical ledger import: original customer/invoice/service/tip, original monetary/tax/discount components where known, receipts/provider identities, historic credits/refunds/failures, remaining paid charge/tip/refundable capacity and evidence. Never allocate a new Crest invoice number, create new sales, debit bank or post old revenue merely to establish this reference. Its funding root begins `legacy_settled`; original pre-cutover returns/failures are nonposting consumed capacity evidence. Roots must not duplicate amounts represented by opening funds, opening AR or another legacy reference; the cutover provenance bridge ties them all.

Required later transitions, only after original evidence and D01/D02 review:

- New post-cutover service concession on previously paid legacy charge: debit4910 gross-net conceded and2100 verified reversible tax; credit4900 original discount reversal and2000 inclusive funds now owed. This is the same net concession as P07, **without AR**, because there is no live unpaid charge to reduce. Create a fund lot from selected legacy-settled root ranges. For a non-taxable100 concession without discount: Dr4910 100 / Cr2000 100. Actual refund: Dr2000 100 / CrM100. Current net book income falls100; no historical sales are re-created.
- Legacy tip return: Dr4100 original net and2100 verified tax / CrM gross, using original proven tip capacity; failed outgoing recovery follows §24.3. No existing current tip revenue is required to falsely "support" the reduction; report clearly as prior-coverage transaction adjustment.
- Legacy collection dishonored after cutover: debit1100 for the still-enforceable charge amount and credit the actually debited money account. Create a typed `legacy_collection_failure` receivable item with original due date/charge evidence. Do not credit SR or opening equity. Reduce the proven legacy-settled root by the failed amount. If liability/tip/refund dependencies exist, use the same component-aware rules and exceptional suspense protection as §4.4.
- Error in the cutover balance itself, rather than a new economic concession/failure: linked opening correction remains appropriate. A true post-cutover event cannot be moved to3000 simply because the original sale was old.

Unknown original tax/refund entitlement blocks the proposed classification; actual cash evidence may be recorded in approved suspense without certifying it. No engineer chooses tax recovery or legal enforceability. If legacy paid records will never be needed, no bulk import/UI is required; review these references on demand before the relevant event. They remain reference-only until a **new** economic event posts. Extend `receivable_item` branches to include legacy failure; each item has exactly one invoice/opening/failure origin. Opening balances cover each actual economic account once, with one primary cutover. Plan revisions after posting create linked delta corrections, not another full P27 entry per plan version.

### 24.7 Reconciliation across statement and accounting dates

**F09 - High: reconciling cash on later correction dates can manufacture a false timing difference.** Normal B=S+O assumes all statement transactions have book effects by q, apart from genuine book-first outstanding items. If an actual January transaction was omitted and is corrected in February because January stays locked, January cannot be called fully reconciled under that equation. Preserve January as Needs Review/qualified and obtain explicit period-reopen/repost direction or retain a documented prior-period-correction bridge. Such a bridge discloses the exact source/date mismatch; it is not a fabricated deposit/check timing item and does not satisfy a clean January reconciliation gate. Do not silently backdate the money movement or label an unexplained residual "outstanding."

For complete reconciliation, each statement row is either matched to a book movement with the appropriate accounting/timing evidence or formally excluded as duplicate/nontransaction provider metadata. Exclusion preserves reason, canonical alias and amount; it cannot remove a true movement from the statement balance equation. Outstanding timing items reference net un-cleared original movements with as-of clearance dates. Clearing later does not erase their outstanding status in an earlier report. Corrections to matched money movement invalidate affected matches and all balance-dependent successor reconciliations; retain superseded matches as history, exclude them from **current** match capacity. A reapproved revision may reuse the same valid evidence without counting historic match revisions twice.

Posting/close validation must compare source and control balances for every affected customer/item/root and each effective-date boundary, not merely overall AR/funds. A source and journal both pointed at the wrong customer can pass equality; therefore independently verify source ancestry against the immutable agreement/payment confirmation, and require explicit reviewed customer reattribution (§24.3). Integrity tests must tamper with both source and ledger dimensions together to prove the ancestry check catches it.

### 24.8 Missing revenue, operational basis and report completeness

**F10 - High: an "accrual" label may conceal missing year-end work and double-added opening balances.** Preserve approved BR12 recognition at explicit invoice issue, not automatic completion accrual. Label reports **Operational books - invoice-issued recognition; not full accrual financial statements** unless a separately adopted adviser adjustment process fully accounts for omissions. Completed-but-unbilled work is reconciled from all completion/entitlement outcomes, not just saved invoice drafts. Deleting/abandoning a draft cannot remove the exception. Unbilled authorized completed value and count appear in close/export coverage. Finalizing work/payment together must not be the only path checked. Source-to-revenue completeness is bidirectional: every issued invoice posts exactly once, and every billable completed scope is invoiced, reserved for billing, or explicitly cancelled/complimentary/credited with evidence.

An incomplete close does not convert missing work/cost into zero. Gross/discount/return totals use immutable issued/correcting amounts and exclude reference history. Opening journal lines count once: sum all ledger lines for TB; never add opening_items again. Current/previous earnings remain derived once under §13. Report corrections to prior covered or pre-cutover transactions separately in a bridge to current recorded-book income, without adding them twice. On-demand legacy adjustments carry a prior-coverage flag. Customer collection metrics exclude failed receipt effects on their failure date, distinguish gross received/failed/returned/recredited amounts, and do not treat a failed outgoing refund's recredit as a new sale/receipt.

### 24.9 Restore, retry identity and numbering

**F11 - Critical: restoring the database loses operation IDs after the restore point; a reopened phone can replay a previously successful command.** Every mutating command, including finance, carries a server-issued `recovery_epoch` matching the active business recovery authority. ARCHITECTURE section 5 requires a shared authority lock through commit and epoch validation before operation replay; recovery takes the exclusive fence and drains/fences old processes before resumption. Normal deployments do not change this epoch. During production recovery pause writes and rotate the epoch before reopening; revoke sessions and reject all commands/queued client operations from earlier epochs with RECOVERY_REVIEW_REQUIRED, even if their operation ID is absent in restored DB. The epoch is server checked, not a client permission. An already known operation can be looked up read-only for incident review, but no stale payload is automatically resubmitted under the new epoch. Owner-approved evidence reconstruction binds original source/provider/operation IDs as aliases to the recovered event; a fresh ID cannot bypass duplicate review. Ordinary timeout recovery within an unchanged epoch retains ARCHITECTURE §5's identical-key retry rules.

Reserve every known externally issued later invoice number before reopening. If the old high-water mark cannot be established, use a new explicit recovery-series namespace whose identifier includes the new persisted recovery-epoch UUID; the user-facing full invoice number includes that series and a new sequence. Uniqueness is on the **full number**, never just the restarted numeric suffix. Preserve recovered original numbers verbatim; never assign a new number to an already externally issued invoice just to fit the series. Unknown transactions and financially material loss windows still block clean financial recovery: a new namespace prevents collisions but does not recreate missing books. Explicit bounded recovery/qualified operation needs owner review and incident coverage warnings; no silent "all reconciled" claim.

Successful financial operation/source identity tombstones remain for the lifetime of history, including corrections. Import batch identity and file hashes do not replace economic identities. External-effect tasks cannot replay provider collection/refund because required V1 does not initiate such external money movement. A recovered DB cannot clear an unresolved external payment merely because the original local command is absent.

### 24.10 Concurrency, amendment and event-order contracts

**F12 - High: a credit-reissue gap or same-date ordering can bypass otherwise balanced controls.** Replacement billing is atomic or consumption remains explicitly reserved (§5). Account mappings, period locks, reconciliation approval, statement economic-identity claims and root range consumption all hold the same business finance lock. Read snapshots for a review screen do not reserve capacity; submission rechecks versions, availability and duplicate candidates.

For deterministic daily-book validation order use `(effective_date, opening_before_ordinary, finance_commit_sequence, event_sequence_within_atomic_group, entry_sequence)`. Allocate finance_commit_sequence monotonically under the finance lock; it is not an invoice number. On the same effective date this is recorded accounting order, not a claim about minute-by-minute economic occurrence. Retain actual economic instants separately and reject known impossible dependency chronology (e.g. refund occurred before receipt). Date-only evidence needs explicit confirmation when economic order is uncertain and affects entitlement. Never use random UUID sorting to establish capacity. Source dependencies must precede their dependents in this accounting order; all sources in one new atomic group receive explicit dependency order. A backdated earlier-date group replays all affected later daily/event boundaries, rejecting negative/double-consumed states. Original ordering is immutable; errors need corrective events, not silently renumbering history. Evaluate an atomic credit/replacement group as a group for externally visible balances. New mapping configuration cannot reinterpret previous snapshots on replay.

Two real simultaneous receipts may both be recorded, but each allocation is revalidated; stale allocation plans require owner confirmation of the resulting excess. The same receipt entered on phone/desktop under different IDs is still duplicate-review/external-identity controlled. A tip amount explicitly confirmed by the customer must not be silently moved to invoice allocation after a race; re-review the proposed distribution. No background reconciliation worker may create or reclassify financial sources without the normal reviewed command.

### 24.11 Remaining uncertainty is gated policy, not an implementation default

Unresolved: real tax applicability/date/rounding/presentation/exemption and refund tax recovery; actual account ownership and opening/cutover evidence; capitalization/depreciation and exceptional asset refunds; adviser treatment of material prior-period errors and enforceability/valuation of exceptional recovery claims. These are **per-event or launch gates**. The engine must persist Needs Review/suspense where explicitly allowed and reject unsupported posting plans. "Ask an adviser" cannot mean let Codex choose a convenient account meanwhile.

V1 intentionally has no arbitrary control migration, automated depreciation, automatic bank feed, historical ledger replay, tax filing or automatic bad-debt write-off. Their absence is not an incomplete rule that Codex must invent. New unsupported economic situations require an explicit specification/policy amendment before posting; retaining actual money as reviewed suspense preserves evidence while that decision is made. No specification can establish omitted real-world facts or prove absence of all semantic defects; this review makes no such guarantee.

### 24.12 Additional cross-document changes adopted

X20-X28 supplement X01-X19 and are all adopted in this canonical baseline. Companion contents have been corrected; the table preserves traceability, not a pending instruction list.

| ID | Document / section | Adopted amendment in canonical companion |
|---|---|---|
| X20 | BUSINESS_RULES BR11.3/BR12.2-3 | Adopt original-offset range allocation/restoration; distinguish failed incoming collection from failed outgoing refund, including tip-return liability and exact restoration (§§7/24.1/24.3) |
| X21 | BUSINESS_RULES BR13; PRODUCT P13/P15 | Separate incurred/payment/claim dates; owner-funded AP settlement; reflect recorded-book limitations and per-event D03 gates (§§8/24.2/24.5) |
| X22 | DATABASE §7 | Add original-range consumption/restoration constraints, embedded-fee XOR separate-fee identity, generic unidentified resolutions, cost-origin destination lineage, legacy settlement/failure origins, pinned controls and net current match revisions (§24) |
| X23 | DATABASE §§2/7/8; ARCHITECTURE §5; EXPORTS_AND_BACKUPS §7 | Add finance recovery epoch to commands/authority and rejected stale retry behavior, external economic-envelope aliases and full-number recovery series; preserve prior IDs and incident evidence (§24.9) |
| X24 | BUSINESS_RULES BR06; DATABASE billing_consumptions | Replace "where possible"/unspecified release behavior with atomic credit/consumption transfer/reissue or persistent reservation; disallow reversing predecessor credit without resolving successor (§§5/24.1) |
| X25 | BUSINESS_RULES BR12.4/BR14; DATABASE reconciliation/period tables | Prior-period correction is not a normal timing item; immutable as-of clearance/match revisions; explicit qualified reconciliation; TB openings counted exactly once (§24.7-8) |
| X26 | TESTING F5/§4 | Add the concrete F01-F12 failures and R01-R12 fixtures below; test reversing non-last credits, dated purchases, failed tip refund, legacy correction, embedded fees, stale recovered commands and ancestry tampering-not balance alone |
| X27 | ARCHITECTURE_REVIEW R05/R06/R07/R11/R26/R27, Disposition | Record these newly discovered semantic defects and corrected contracts; distinguish independent-minded self-review from external professional review; no test/production certification |
| X28 | ARCHITECTURE_DECISIONS ADR21/D02/D12; ROADMAP phases0/8-12 | ACCOUNTING1.4 adopted for finance implementation; used control remapping disabled; legacy evidence stays nonposting; required source/range/epoch fields precede billing/imports |

PRODUCT's V1 boundary, architecture/runtime, security/session requirements, budget/backups and owner priorities remain unchanged. PRODUCT P17 contact-only migration is preserved: on-demand legacy settlement evidence is not historical ledger import. Do not revise source precedence or legal/tax policy to make these amendments appear pre-approved.

### 24.13 Targeted final-review fixtures

Amounts are integer cents unless dollars explicitly stated. These are specification fixtures; actual database/concurrency/recovery tests remain implementation requirements.

| ID | Attack fixture | Required result |
|---|---|---|
| R01 | A6/N5/t1; credit3, credit1, reverse first3, credit1 | Credit components3/0,0/1; reversal exact3/0; new credit1/0. No tax−1; remaining available ranges exact |
| R02 | Jan31 supplies100 dollars, Feb2 bank payment100 dollars | Jan expense100/AP100, Jan bank unchanged; Feb AP0/bank−100; expense only once |
| R03 | Tip25 dollars refunded; provider returns failed transfer; retry refund | DrTR25 Crbank25; Drbank25 CrF25; DrF25 Crbank25. Tips reduced once, final funds0, net money−25 |
| R04 | Unknown bank inflow500 dollars proven owner contribution | Drbank500 Cr2390; Dr2390 CrOC500; revenue0, F0, bank+500 once |
| R05 | Receipt475 dollars, provider retains10 dollars | Wallet+465, fee10, AR450, tips25; no extra standalone fee; envelope sum465 |
| R06 | Used AR mapping changed then old invoice credited | Mapping mutation rejected; original invoice/control account remains valid |
| R07 | Expense100 dollars reclassified to asset, supplier returns20 | Credit remaining asset20 (with reviewed basis plan if depreciated), not original expense; bank+20 once |
| R08 | Legacy paid450 dollars invoice; new100 concession/refund | DrR100 CrF100; DrF100 Crbank100; current AR0, no new450 sales; original legacy capacity decreases100 |
| R09 | January bank debit omitted; discovered after lock and corrected February | January not clean-reconciled via fake timing item; explicit period/bridge decision and history retained |
| R10 | Opening bank1000 dollars included in P27; trial balance from cutover | Bank1000, not2000; report opening before cutover0, period movement1000 |
| R11 | Restore before committed payment; old phone retries original missing operation | Old recovery epoch rejected, no new posting; evidence reconstruction/review resolves original external identity |
| R12 | Both source and journal customer changed to same wrong customer; credit/reissue raced | Immutable ancestry mismatch rejected; consumption never unreserved between predecessor/successor; no duplicate revenue |

Final review verification: exact-integer checks passed 24,000 consume/partial-reversal state transitions across original amounts, tax proportions and discounts, plus 11 balanced transition fixtures. The earlier 74,569 monotonic cumulative-boundary checks in section 23 did not exercise reversal of a non-last credit and therefore missed F01; they are not evidence for the superseded algorithm. These checks validate specification arithmetic only. Database, concurrent-device, restore and end-to-end accounting tests remain required implementation work.

Final readiness: repository creation and nonfinancial/synthetic financial implementation are ready on canonical ACCOUNTING1.4 and its reconciled companion schemas. Real financial activation remains gated. No unresolved generic accounting behavior is delegated to Codex for the supported V1 events; remaining real-world policy/evidence decisions are explicit gates. Production activation and confidence in implemented behavior still require actual tests, adviser/owner configurations, reconciled openings, security/recovery proof and pilot review.

## 25. Private activation evidence and remaining boundaries

The original owner-specific operating facts are retained privately. Public implementation requirements are unchanged:

- Verify legal entity and tax classification with the owner/adviser; never infer tax elections from an entity label.
- D01 requires verified service-specific jurisdiction, registration, applicability and effective dates. Current practice is not proof of exemption or compliance.
- D02/D12 require actual channel ownership, business-only custody scope and supported openings. Do not seed hypothetical accounts or import entire personal balances.
- Prospective bookkeeping does not authorize zero openings. Establish supported assets, receivables, customer funds and debts; disclose gaps and never fabricate history.
- Deliver complete accountant exports for all business activity, irrespective of customer type or payment channel. No filtered subset may be represented as complete books.

Indiana guidance checked 2026-10-20: DOR Sales Tax Information Bulletin 15 (April 2023), page 2, states under Service Station Nontaxable Transactions that charges for washes, lubrications, polishing and waxing are not subject to sales tax, and the service station pays sales/use tax on consumed supplies. Source: https://secure.in.gov/dor/files/sib15.pdf . This supports targeted review; it is not a blanket ruling for Crest's complete mobile detailing catalog, coatings, bundled products or separately sold goods. D01 remains pending verified service-specific applicability and effective dates. Do not automatically apply either 0% or 7% to every service on this evidence.

D02 involves mixed personal accounts. Section26 now resolves the technical model and posting/reconciliation contract; Codex MUST implement it rather than select another treatment. Actual channel identity, business custody opening evidence, personal funding intent and repayment obligations remain activation/per-event facts. Dedicated account ownership must be verified; no entire personal balance becomes Crest property through bookkeeping.

PRODUCT, BUSINESS_RULES, DATABASE and the decision register incorporate these facts: owner custody and personal funding are supported workflows, dedicated accounts require evidence, historical coverage must be disclosed, and service-tax profiles require verification. Profitability reports distinguish recorded costs and missing/unallocated costs; no claim of fully burdened job profit or complete accountant-ready financial statements follows from incomplete inputs.

Readiness after canonical adoption: repository creation and nonfinancial/synthetic financial implementation may begin. Section26 and companion amendments resolve the technical dependency. Actual tax verification, supported custody/other openings, cutover, implemented release/security/recovery tests and pilot reconciliation still block real financial activation. No actual values or tax treatment are approved by this document.

## 26. Adopted business-only owner-custody and settlement contract

### 26.1 Selection, boundaries and activation

**Selected V1 design:** separate business-only owner-custody asset control per mixed personal payment/bank/cash channel, in the1070 account family. Label it **Business funds held by owner**, not business bank cash. It measures Crest's economic interest in specifically recorded business receipts/funding still held or administered by the owner. It does not import the owner's whole personal balance, create a legal trust/segregation claim, or assert a loan or legally enforceable receivable. This technical bookkeeping choice does not depend on selecting legal/tax ownership treatment. If an adviser requires different formal financial presentation, record an explicit policy/specification amendment before applying it, never let Codex silently reclassify history.

Why custody instead of immediate automatic drawings: customer settlement, business fees/refunds and remaining funds remain traceable before the owner chooses their disposition. Why not full wallet cash: unrelated personal activity and wealth are outside Crest. Why not automatic due-from-owner: no debt obligation has been established merely by receiving business money. No second signed owner-clearing balance or automatic netting is required. Existing2350 is used only for a genuine explicitly selected reimbursement obligation when the owner personally funds a business outflow. No general owner-loan origination product or due-from-owner loan control is introduced.

Each channel has an owner, provider/masked identifier, custody scope, pinned control, effective activation and supported opening. Dedicated business accounts may be added later as distinct controls with evidence; no account is silently relabeled or remapped. Actual channel types, identifiers and amounts are private D02/D12 activation inputs; synthetic channels exercise every supported funding model. A channel cannot post with an unknown opening: verified zero is acceptable with evidence. Historical incompleteness remains visible even if a bounded synthetic or approved non-primary pilot is possible.

### 26.2 Two distinct lineages and allocation protocol

Customer funding origins track the customer's economic classification/capacity through AR, funds, tips, refunds and failures. Custody lots track **where Crest money is held or how it was used**. These are different dimensions: moving custody never reopens AR, creates a second receipt root or changes customer refund capacity. After earning payment, the business may spend that money; a later refund can be financed from another verified business channel or explicit personal funding. Customer funds liability stays payable even after cash was used/distributed.

Create immutable custody lots for net business amounts received, contributed, transferred in, supplier refunds and supported openings. Lot/control balance derives from append-only selected input/output slices; lots and channel custody cannot become negative at any accounting boundary. Outflow funding plan explicitly selects available custody lot cents, dedicated business money and/or personal funding cents. UI may suggest oldest available custody by effective date/sequence, but owner must confirm named amounts. Never infer which personal dollars paid a refund from total wallet balance. If custody is insufficient, the unfinanced part remains Needs Review until owner explicitly selects contribution or an evidenced reimbursement obligation; retain real transaction evidence and an unresolved task without pretending it never happened. No guessed automatic overdraft, owner loan or balance plug.

For owner personal funding, record `contribution` or `reimbursement_due` per event with owner confirmation; the latter requires genuine repayment intent, original business outflow evidence and named obligation. Neither choice is a tax election. Synthetic tests exercise both exact templates. Personal funds already outside Crest are not a business asset until an explicit contribution/financing event makes them available for business use. Do not infer a contribution merely from personal money entering the same wallet.

### 26.3 Exact posting contract

Use C=selected1070 custody control, OC=3100, OD=3200, O=2350, M=verified dedicated business money. Every row inherits section4.1 identity, dates, controls, evidence, approval and atomicity. All amounts are business portions; unrelated personal portions remain outside journals. Receipt recognition credits AR/tips/funds under the existing contract, never owner contribution or service revenue again.

| Event | Required entries and boundary |
|---|---|
| Business customer receipt physically credited to mixed channel | DrC net received + Dr5300 evidenced embedded fee; CrAR applied + Cr4100/2100 verified tip + Cr2000 excess, totaling gross. Funding root=gross; custody=net. No bank movement and no owner contribution |
| Unknown inflow with evidence it belongs to Crest, payer/cause unknown | DrC / Cr2390; ordinary typed resolution under24.4. An unidentified personal deposit is not presumed business; retain only review evidence until business scope is confirmed |
| Business cost paid from existing custody | Dr reviewed expense/asset (or Dr2200 for already-incurred AP) / CrC selected cents. Incurrence/payment dates remain8/24.2; personal portion is outside business cost |
| Business cost personally funded | Dr reviewed expense/asset or2200 / CrOC or evidenced O. Excluded personal purchase portion has no ledger effect. No phantom business cash |
| Mixed funding cost100: custody60, personal40 | Dr expense100 / CrC60 / CrOC40 orO40, or the same split against AP on settlement date. Funding selection is explicit; cannot also book full100 cash expense |
| Actual fee debited from channel | Dr5300 / CrC available selected amount and CrOC/O explicitly funded remainder. Separate fee evidence required; embedded fee cannot be posted again |
| Transfer from custody to verified business bank/cash | Dispatch Dr1060/CrC; actual arrival DrM+fee/Cr1060. Same-date confirmed transfer may DrM+fee/CrC. No revenue, contribution or draw |
| Transfer business custody between two personal channels | Same transfer templates with Csource/Cdestination and1060 if dates differ; selected business portion only. Excluded personal transfer amount remains outside Crest. No draw merely because destination is also personal |
| Owner explicitly appropriates custody for personal use | DrOD / CrC; retain withdrawal/appropriation evidence and selected lot amounts. Same-account appropriation is a noncash ownership reclassification, not fabricated bank transfer; fees and distinct real transfers retain their own evidence |
| Owner explicitly contributes personal funds into business custody | DrC / CrOC, with identified amount/evidence and ownership designation. If no external transfer occurs, mark noncash ownership designation; do not invent an external envelope or money movement |
| Reimburse existing due-owner obligation from custody or business money | DrO / CrC orM, capped by selected still-unpaid obligation. Same-account settlement may be noncash ownership reclassification with explicit agreement. Custody and O are never automatically offset |
| Refund service/excess from custody | Dr2000 / CrC; original funds/root links. If owner personally finances part, creditOC orO for that part; liability/customer/root consumption remains exact |
| Tip refund from custody/personal funding | Dr4100 original net + Dr2100 original tax / CrC and/or explicitly selectedOC/O. Consume original tip ranges; no service credit |
| Actual incoming collection fails | Debit surviving AR/F/tip/tax per4.4; credit actually debited custody amount and explicitly selectedOC/O for personal-funded shortfall. Preserve root, actual provider identity and prior custody transfers. Never debit original empty wallet or invent new revenue |
| Failed outgoing refund returns to mixed channel | DrC / Cr2000, same returned root ranges, regardless of original refund funding. The customer is still owed; O orOC from original personal funding remains until separate explicit settlement/correction. Retry Dr2000 / CrC, no repeated tip reduction |
| Previously failed incoming receipt recovered | DrC net with actual fee if any; credit original surviving AR, verified restored tip or funds according to24.3, using same failed root ranges. Existing owner obligation remains unless explicitly settled; do not simultaneously create a fresh root |
| Supplier refund received by owner in mixed channel | DrC / Cr current reviewed remaining cost/tax, orCr1120 if claim already recognized. Creates custody provenance, not customer funding root. If owner retains it to settle O, append DrO/CrC up to obligation. Explicit return of supported original contributed cost uses DrOC/CrC bounded by contribution chain; otherwise explicit distribution DrOD/CrC. External receipt counted once |
| Opening business custody | DrC / Cr3000 as part of combined reviewed opening; no current receipt/revenue. Customer funds/AR openings remain separately reconciled without cash duplication |

Actual withdrawn business money has a real transfer leg if going to another business custody/account, or a distribution if appropriated personally. Do not auto-classify every transfer to the owner's bank as a draw: explicitly select destination business custody versus personal appropriation and amount. Conversely, do not retain an overstated custody asset after evidence shows personal appropriation. Unrelated personal purchases have no entry unless the owner identifies consumption of Crest custody; then record the distribution. If review cannot establish whether Crest custody remains supported, flag discrepancy and block clean reconciliation; no automatic "remaining personal balance" allocation.

Correction versus actual return remains4.4/24.3: an erroneous no-movement record reverses exact selected custody/funding/obligation effects, restoring original lots only when dependencies allow. A real returned transaction is a new dated event; contribution/reimbursement choices are not silently unwound. Source-linked correction of an erroneous funding choice can DrOC/CrO or reverse, only with documented original remaining amount, explicit intent and no duplicate prior settlements; it is not a new expense. Used controls remain pinned.

### 26.3a Owner funding correction capacity

Every contribution creates a typed owner_contribution_lot (including directly owner-paid costs, contributions to custody and contribution-funded refunds/failures), pinned to its source and owner. Its original amount is immutable. Track append-only exact slices as available, returned capital or converted to due-owner; linked reversals restore the same slices once. Available + net capital returned + net converted = original contribution. Restoring converted capacity requires reversing the linked still-unpaid obligation effect atomically; settled obligation slices cannot be restored through this shortcut. A distribution is separately OD and does not silently consume or restore a contribution slice. Contribution capacity is not cash availability: a capital return also requires actual available custody/business funding or an explicitly supported noncash asset return contract; unsupported asset returns remain gated.

DrOC/CrO correction is limited to selected available contribution slices with evidence the original funding classification was erroneous and an actual obligation exists. Create the corresponding owner obligation once. DrO/CrOC correction is limited to the selected still-unpaid obligation and cannot erase already reimbursed portions. If the obligation came from a prior contribution-to-obligation correction, reverse those exact conversion slices and restore their original contribution lot; do not create a second lot. Otherwise create a linked contribution lot for the newly classified contribution. A correction after partial settlement affects only supported remaining slices; changing a settled portion requires a separate documented treatment before posting. Capital return DrOC/CrC orM consumes named available contribution slices; cost-related supplier refund also references the cost-origin range and cannot exceed either its supported contribution slice or actual returned cost. Reimbursement consumes remaining O only. These rules prevent two different command IDs or different source types from returning/converting the same capital twice.

An unidentified personal-channel transaction is not automatically Crest custody. P35 into C requires evidence that the amount is within Crest's business interest even if payer/cause is unknown. If business-versus-personal ownership itself is unknown, retain nonposting evidence with unknown scope and an investigation task; it blocks clean coverage approval. Do not post personal uncertainty as DrC/Cr2390. A confirmed business outflow whose personal funding election is unknown similarly remains pending evidence and blocks clean affected close until that election and posting are resolved. These pending facts must appear in coverage exports/dashboard, not disappear from exception checks.

### 26.4 Business-only evidence and reconciliation

This is **custody reconciliation of Crest activity**, not reconciliation of the owner's whole personal account. Never compare C with the personal statement closing balance, seed personal opening wealth, or require complete personal activity to appear in Crest's journals.

Each relevant external transaction has one canonical evidence envelope. If an envelope includes both business and personal portions, retain exact signed business allocations and an explicitly excluded personal remainder so they sum to the external amount. Exclusion requires owner evidence/reason; uncertain business status is unknown, not automatically excluded. Unrelated personal details may be minimized/redacted before retention while business amount, date, identity, provider status and review evidence remain intact. No personal credentials or bank feeds. Store the fact that the owner reviewed the relevant activity interval for completeness and identified all Crest transactions, plus supporting business excerpts/exports. This attestation is a control, not proof against owner omission.

For interval(s,q], let C0/C1 be business custody balances from approved opening/events; E be net confirmed **business-only external custody increases minus decreases** matched once; N be explicitly approved noncash contribution/appropriation/reimbursement designations; O0/O1 be signed evidenced book timing items outstanding at each boundary. Require `C1-C0 = E + N + O1-O0` and `C1 = sum remaining custody lots = pinned custody control debit balance`. Match every included business event/evidence allocation exactly once across overlapping imports; every excluded personal portion has zero ledger effect. Personally funded outflows are separately matched toOC/O components and do not reduce C again. Maintain a bridge from each external business amount to custody movement, personal-funding portion and fee components. A returned refund counted in C cannot also settle O without an explicit settlement event.

Unknown or omitted business evidence, unsupported opening, unclassified custody appropriation, unallocated real outflow, unresolved mismatch or unreviewed coverage prevents clean custody reconciliation and complete-book claims. Resolve known events with normal typed postings; no balance plug or forced match. Prior-period correction is not timing and preserves qualified status until reviewed under11/24.7. Corrections invalidate affected and successor approvals; as-of clearance and historical match revisions remain immutable. Clean custody reconciliation confirms the documented business boundary only; it cannot certify the entire personal account, legal segregation or completeness of undisclosed activity.

2350 independently equals remaining documented obligations by owner/source. No net presentation with1070. Contributions/distributions report separately from revenue/expense and from actual bank transfers. Custody is separately visible on balance sheet, channel movements, dashboard, accountant exports and openings. Display known omissions and recorded-book limitations. Existing C01-C22, recovery epochs and external identity controls apply without exception.

### 26.5 Synthetic owner-custody fixtures (USD dollars)

| ID | Scenario | Exact expected result |
|---|---|---|
| O01 | Personal wallet holds unrelated900; Crest450 invoice paid475 with confirmed25 tip | DrC475 CrAR450 CrTR25; C475, personal900 never in ledger; noOC/bank; one root475 |
| O02 | Same receipt with evidenced10 embedded fee | DrC465 DrFees10 CrAR450 CrTR25; root475, C465; no standalone fee |
| O03 | O01 custody transfers200 to owner's other mixed channel, arriving next day | Day1 DrTransit200 CrC1; day2 DrC2 200 CrTransit; C1 275/C2 200, no equity/revenue; selected business portion only |
| O04 | Owner appropriates100 from O01 | DrOD100 CrC100; C375; customer settlement unchanged, no expense |
| O05 | Supplies100; custody60 plus personal40 | DrSupplies100 CrC60 CrOC40, orCrO40 with explicit repayment intent; personal total balance excluded; no negative custody |
| O06 | O05 due-owner40 reimbursed from later custody | DrO40 CrC40; expense still100; O0; second reimbursement rejected |
| O07 | Tip25 refund personally funded with explicitO; fails and returns to mixed wallet; retry using custody | DrTR25 CrO25; DrC25 CrF25; DrF25 CrC25. NetTR-25,O25,C0,F0. Refund remains owed until retry; no double revenue reduction |
| O08 | AR450 receipt entered in custody, later fully appropriated personally; provider claws450 from personal funds, owner elects contribution | Receipt DrC450 CrAR450; draw DrOD450 CrC450; failure DrAR450 CrOC450. C0, AR450, SR unchanged, OC450/OD450 separately shown; no negative custody or invented bank debit |
| O09 | Personally funded100 supplies withO100; supplier returns20 to mixed channel and owner retains it against obligation | DrC20 CrSupplies20; DrO20 CrC20 atomically. Expense80,O80,C0; external refund20 counted once; if O already paid, cannot reduce it again |
| O10 | C0=50, matched business receipt100, personal-funded cost20, custody cost30, explicit appropriation10 | C1=110; E=70,N=-10 => change60. Personal-funded20 goes toOC/O and is excluded from custody change; unrelated personal transactions/balance have zero ledger effect |

Also test a refund from another custody channel, mixed business/personal transfer evidence, supplier refund after asset reclassification, failed transfer return and later fee, contribution-to-obligation correction after partial reimbursement, unknown opening, concurrent use of last custody lot and dated reversal after distribution. Exact range/cost/customer controls still apply. No test implies real ownership/tax approval.

### 26.6 Actual activation inputs versus finished design

Implementation may begin with synthetic named channels, amounts and both explicit funding options. Real activation requires owner verification of masked channels, business-custody opening amounts and evidence/coverage, actual cutover, mappings, per-event funding intent and any genuine2350 obligations. D01 gates relevant service/tip/tax postings; D03 gates only unresolved affected cost/asset/prepaid cases. No new requirement that the owner choose debit/credit architecture remains. If an exceptional event cannot be represented safely, capture evidence and amend policy/contract before posting rather than inventing a loan or tax treatment.

General recordkeeping guidance was checked at https://www.irs.gov/publications/p583 on2026-10-20: identify business receipt sources and preserve supporting records; separate business accounts are recommended. This does not prescribe or professionally certify the Crest-specific custody design above, which is a documented technical selection.
