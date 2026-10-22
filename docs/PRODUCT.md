# Crest OS V1 - Product Specification

Version: 1.5 | 2026-10-22 | Owner-requested V1 Calendar contract; implementation and production gated

Calendar scope amendment, 2026-10-22: the owner requested Google Calendar connection support in V1. P20/BR21/ADR35 now require the capability with optional owner activation, outbound-only projection and unchanged integrity/security/recovery gates. This supersedes older optional/excluded Calendar wording only. Current versions and immutable-baseline amendment evidence are in CANONICAL_MAINTENANCE.md; implementation/research and unexecuted provider gates are in [the Calendar contract](../planning/GOOGLE_CALENDAR_V1.md). No live integration or production approval is implied.

Public edition, 2026-10-20: owner-authorized public source; application access and business evidence remain private. PUBLICATION.md records this explicit privacy/provenance amendment and the current authority/version register. Earlier private-repository and budget/authorization statements below are historical where superseded there. No security, accounting, recovery or real-data activation gate is waived.

This is the canonical V1 specification baseline adopted by the 2026-10-20 reconciliation request, not evidence of software completion or approval of unresolved real-world policies. Source precedence remains current repository documentation and explicit current decisions, the owner's latest explicit statements, CREST_CONTEXT.md, historical examples, then public copy. PRODUCT owns scope and outcomes; BUSINESS_RULES owns operational invariants; ACCOUNTING owns specialized posting, control, reporting and owner-custody semantics; DATABASE/ARCHITECTURE/SECURITY/TESTING/EXPORTS_AND_BACKUPS implement those contracts. Specialized accounting authority does not override unrelated product or security decisions. A future true conflict requires an explicit documented amendment before affected implementation. All canonical versions are dated 2026-10-20; PRODUCT/BUSINESS_RULES 1.2, ACCOUNTING 1.4, technical companions 1.3.

## 1. Authority, scope, and interpretation

Primary reference: the complete project file `sources/Crest_Context.md`, internally titled CREST_CONTEXT.md, last consolidated October 19, 2026. Project AGENTS.md and the current specification request also govern this work. No additional repository product documentation was present in the supplied workspace.

Source precedence remains: (1) current repository documentation and explicit current decisions; (2) the owner's latest explicit statements; (3) CREST_CONTEXT.md; (4) historical quotes/chats/examples; (5) website/public copy. This reconciled baseline governs implementation and is ready to be copied into a new repository. Adoption of the technical contract does not approve unresolved production policies. Future changes must identify affected requirement IDs, rationale, migrations where applicable, and regression tests.

PRODUCT.md owns scope, user outcomes, release gates, and acceptance criteria. BUSINESS_RULES.md owns invariants, calculations and state transitions; ACCOUNTING.md supplies the specialized accounting contract. Neither silently overrides a conflict in the other: resolve and revise both before implementing the disputed behavior.

Requirement labels:

- **Required V1:** needed before V1 becomes Crest's primary operating system. A production gate may restrict activation until configuration is approved.
- **Optional V1:** may ship only after required work passes its gates; absence does not fail V1.
- **Future:** excluded from V1 implementation, except preserving ordinary relational extensibility.
- **Unresolved:** not an instruction to invent a default. Decision register D01-D12 defines what remains possible and what is gated.

Implementation conventions explicitly introduced here include separate work/payment/transport states, immutable financial posting, revision-specific acceptance, manual confirmation of native messages, and conservative operational defaults. They make the requested workflows implementable without creating new commercial policies. They are adopted technical decisions in this specification.

## 2. Product purpose and boundaries

Crest OS is the private operating system for Crest Detailing LLC, initially operated only by the owner. It must connect an inquiry to customer/vehicle history, a reviewed quote, confirmed work, collection, bookkeeping, review outreach, and rebooking. Data integrity, accounting correctness, privacy, reliability, recovery, maintainability, and portability take precedence over polish.

V1 is a responsive web application with an installable home-screen experience where supported. Both phone and desktop use the same authoritative records. Browser-based operation is sufficient; native apps and full offline synchronization are excluded. ARCHITECTURE.md selects the standard Node/Next.js modular monolith and budget pilot; this product specification does not independently select providers.

V1 uses one business, one owner account, USD, and an explicitly configured business timezone initially America/Indiana/Indianapolis. These are documented V1 boundaries, not hardcoded assumptions that historical records may be rewritten later. No employee, multi-location, or multi-currency UI is required.

### 2.1 Required scope

| Area | Required V1 delivery | Boundary |
|---|---|---|
| Access | Owner provisioning, secure login/recovery, trusted sessions, logout/revocation | No public account registration |
| CRM | Leads, conversion, customers, multiple addresses and vehicles, search, history | No automatic identity merges |
| Catalog/pricing | Editable services, five categories, four conditions, owner-controlled flat quotes and discounts | Price examples are guidance, never enforced defaults |
| Quotes | Review, customer-ready presentation, revisions, acceptance evidence, immutable accepted scope | Manual sharing and recorded external acceptance suffice |
| Operations | Calendar, scheduling, rescheduling, cancellation, mobile travel, timing, photos, completion; P20 Google Calendar connection capability | Google connection opt-in; outbound-only dedicated-calendar view, no route optimizer or autonomous dispatch |
| Fulfillment | Working mobile, customer drop-off, and Crest pickup/return workflows | Mobile and Drop-Off enabled; Pickup + Return separately gated; no implied insurance coverage |
| Communications | Native text/call links, copy fallback, review request at completion, manual maintenance queue | No paid SMS requirement or delivery claims without evidence |
| Money | Invoices, split/partial payments, tips, excess funds, refunds, reversals | Manual recording of external money movement, no direct cards |
| Expenses | Vendors, expense review, receipts, account/category/job attribution | No OCR dependency |
| Books | Balanced ledger, accounts, opening balances, source posting, transfers, owner equity, manual adjustments, reconciliation | No autonomous tax decisions or depreciation engine |
| Insights | Defined dashboard, operational reports, P&L, balance sheet, trial balance and ledger | No unsupported predictive CLV or fully allocated job profit |
| Portability | Complete CSVs for implemented entities, useful Excel workbooks, financial PDF reports and attachment retrieval | Single full archive ZIP is future |
| Recovery | Database and attachment recovery, monitored backups, demonstrated restore | Export is not a backup |
| Imports | Reviewed CSV contact/vehicle/history imports and bank/payment transaction staging | No live bank feed; vendor-specific adapters can follow |
| Delivery | Mobile and desktop workflows, security, audit, separate development/staging/production | Production data excluded from routine development |

### 2.2 Optional V1

Passkeys; quote view/accept links with narrowly scoped revocable tokens; geocoding and route/ETA suggestions; structured website lead intake; receipt OCR; reviewed AI intake/quote suggestions; configurable recurrence that creates proposals rather than commitments; asset register without automated depreciation. Each must meet the same privacy, audit, deduplication, and owner-review standards. None may delay the required manual workflow. Mapping failure must leave manual ETA/distance and directions available.

### 2.3 Future, not V1

Employees/roles/payroll, multiple locations, fleet account administration, native applications, customer portal/app, online self-booking, automatic bank feeds, subscriptions, maintenance memberships/billing, inventory, automated SMS/marketing, route optimization, AI receptionist, autonomous quoting/accounting, card processing, deposit collection workflow, automated depreciation, tax filing, cash-flow statement, predictive analytics, and packaged full archive ZIP. Partial payments, excess funds, reversals, and refunds remain required because real collection exceptions cannot safely be deferred.

## 3. Required user journeys and acceptance criteria

All criteria below are release requirements unless explicitly marked optional. BR references point to BUSINESS_RULES.md. Tests must cover successful actions, invalid actions, retry after uncertain network responses, and simultaneous actions from the owner's phone and computer. A UI-only restriction is insufficient.

### P01 - Access and business setup

the owner securely signs in on trusted devices and can revoke a lost device. Setup captures business identity/contact details, official logo when supplied, timezone, review URL, templates, accepted payment methods/accounts, and financial configuration. Missing branding may use text; never invent an approximation of the official logo. Configuration has version/effective-date history.

Acceptance:

- An unauthenticated request cannot list or fetch customers, files, invoices, exports, or ledger data, including by guessed ID.
- Only the provisioned owner can authenticate; password/session recovery does not expose business data to an unverified claimant.
- Logout or device revocation prevents further protected requests; sensitive administrative actions require recent authentication (BR01).
- Missing tax/account configuration visibly blocks production invoice posting while drafts, scheduling, and nonfinancial work remain usable.

### P02 - Capture and follow up a lead

Capture an inquiry quickly with name/display label, whatever contact information is available, source, service address early when practical, requested vehicles/services, condition notes/photos, availability, estimated value, notes, and follow-up date. Unknown values remain unknown. Lost leads remain searchable and may be reopened.

Acceptance:

- A lead can be saved without a full street address, VIN, email, or price. Missing operational details are surfaced before the action that needs them.
- Duplicate phone/email or similar vehicle data prompts review but never silently merges people; household shared contact information is allowed.
- Follow-up due dates surface on the dashboard, including overdue lost leads explicitly scheduled for outreach.
- Changing a source or lost reason preserves audit history. Losing a lead does not delete quotes/photos.

### P03 - Convert without retyping; preserve customer history

Conversion creates or explicitly links a customer, selected vehicles and addresses, preserving lead source, notes, attachments and quote relationships. Existing customers may create new leads/opportunities. Customer and vehicle views expose past jobs, photos, accepted quotes, invoices, receipts of payment, outstanding balances and follow-ups. Phone, email, VIN and plate are optional where unavailable.

Acceptance:

- Convert a lead with two vehicles and two addresses; all selected data appears on the linked customer and the original lead remains traceable.
- Retry conversion after a timeout; exactly one conversion mapping exists. Linking an existing customer does not duplicate it.
- Customer record creation does not mark an opportunity Won. Acceptance of a valid quote does, even if conversion is executed in the same transaction.
- Changing a current address, vehicle owner or vehicle description leaves prior commercial/financial snapshots intact. Historical photos remain associated with the original job/customer context.
- Searching an archived customer returns history when archived records are included; financial history cannot be deleted through CRM controls.

### P04 - Build, review, and present a quote

Create a quote for a lead or customer, one or more vehicles, the service location, concrete service inclusions/exclusions, category/condition, price lines, add-ons/specialty scope, discounts, travel treatment, notes and optional appointment proposal. Approximate prices inform the owner; he sets every offered amount. Extreme condition requires explicit manual review. Quotes have no expiration by default.

Acceptance:

- An interior service includes applicable leather care; exterior protection is included only when expressly selected. No generated text guarantees odor elimination.
- Editing service catalog prices or condition after a quote was issued does not change the issued representation.
- A quote cannot be marked sent or customer-accepted without owner approval of that exact revision. Any customer-facing draft edit invalidates approval.
- A multi-vehicle bundle presents a total that reconciles to item amounts, discounts and included tax treatment; internal travel/labor assumptions are not inadvertently exposed.
- A route estimate over roughly 35 minutes flags owner review, but does not invent or apply a travel charge. Manual waive/adjust/embed choices remain available.
- Flat all-in customer pricing is preserved. Internal tax fields may remain pending in drafts, but unresolved treatment cannot silently become zero tax in a posted invoice.

### P05 - Revise, accept, and preserve the agreement

V1 accepts customer confirmation by the owner recording its method, time and evidence/reference against the precise sent revision. A portal or digital signature product is not required. Owner approval and customer acceptance are distinct actions. Changed scope after acceptance becomes an explicitly accepted amendment, not an overwrite.

Acceptance:

- Send revision 1, send revision 2, then attempt acceptance of revision 1: reject as superseded. Sending revision 2 must explicitly invalidate revision 1; draft revision 2 alone does not.
- Accept revision 1, change catalog pricing, then invoice: original agreed amounts persist.
- Add work after acceptance: original acceptance remains readable, the amendment shows the price/scope difference, and unaccepted additions are not billable.
- Concurrent acceptance and superseding operations serialize; exactly one valid initial acceptance exists for a quote family.
- Partial customer acceptance requires a revised offer; a free-text note cannot silently remove a vehicle or split a bundle price.

### P06 - Schedule, reschedule, and cancel

The internal calendar shows confirmed jobs with customer, vehicles, scope, address, fulfillment mode, start, duration, travel estimate and operational state. Proposed appointment times do not reserve a confirmed slot. A quote can cover multiple vehicles and be fulfilled in one or several linked jobs without billing a line twice.

Acceptance:

- Schedule from accepted scope after selecting customer, vehicle(s), confirmed date/time, duration and exact work location; calendar and job agree.
- Conflict checks include expected work and known travel. the owner may override a conflict with a recorded reason; unknown travel is clearly flagged.
- Reschedule preserves job ID and old/new times/reason, regenerates the confirmation draft, and does not duplicate scope, invoices or review requests.
- Cancel a scheduled job: remove its active reservation, preserve accepted terms/history, and apply no automatic fee. An existing receivable or payment is not erased.
- A wasted trip, weather stop or no-show records reason and actual travel; cancellation of active work follows BR07 rather than pretending nothing occurred.

### P07 - Mobile En Route, ETA, Arrived, timer and pauses

The scheduled job provides En Route, directions, call/text, ETA and address. En Route records departure, creates a travel leg and prepares a configurable ETA message. Arrived closes the leg and automatically begins active work. Pauses capture interruption time/reason; resume continues the same job. Active work survives closing/reopening the browser because durations derive from persisted timestamps.

Acceptance:

- Double-tap En Route: one departure/travel leg/message preparation exists. No automatic text is sent.
- Deny location permission or lose routing service: manual departure location, ETA and mileage remain possible.
- Tap Arrived once: one arrival and one active interval exist. Missing mileage leaves a visible incomplete travel record; it does not prevent starting work or fabricate a distance.
- Pause 10 minutes during 70 minutes elapsed work: active time is 60 minutes. Finish while paused closes the pause correctly.
- A forgotten timer can be corrected with reason, original values and actor retained. Two devices cannot create overlapping active labor intervals.
- Native messaging launch is logged as prepared/opened, not sent; the owner can explicitly confirm sent or mark skipped/failed.

### P08 - Other fulfillment modes and custody

Mobile and Customer Drop-Off are enabled initially, explicitly authorized by the owner on 2026-10-20. Crest Pickup + Return is built and tested in V1 but remains disabled until separately enabled by the owner. Work location is separate from pickup and return locations. The workflow tracks vehicle custody, transport timestamps, legs, condition photos, authorization acknowledgements when configured, and return outcome. It does not assert legal sufficiency or activate a contract by itself.

Acceptance:

- Drop-off intake starts custody and records condition; Start Work begins labor separately. No fictional Crest outbound trip is created.
- Pickup begins a transport workflow; arriving at the customer's pickup point does not start detailing labor. Arrival at the work site starts work only through the correct work-start action.
- Finish detailing: job work becomes Completed and immediate review draft is prepared; vehicle still awaiting return remains visibly in Crest custody.
- Returning or releasing a vehicle records recipient/time and ends custody. A cancelled job with vehicle still held remains in a visible return-required queue.
- Transport mileage identifies the actual driven vehicle; customer-vehicle mileage is not counted as business-rig mileage or automatically treated as deductible.

### P09 - Capture photos and complete work

Capture before/damage/during/after/problem photos linked to job and vehicle. Upload status is visible; photos can be added later. End Job stops timing and records completed scope/exceptions, walkthrough done/unavailable, and completion time. It immediately presents the thank-you/Google-review draft, then payment/finalization and follow-up options. Payment is not a prerequisite for completion or the review prompt.

Acceptance:

- Two vehicles on a job have independently retrievable photos; an unassigned image must be explicitly categorized as job-wide and never misattributed.
- Failed uploads remain visibly failed/retryable, never presented as backed-up history. Completion warns about pending evidence but does not falsely mark uploads successful.
- A crash after completion commits but before the message opens allows recovery of the same review request without a duplicate completion/invoice.
- Completion before payment prepares the review ask immediately; later payment does not create a second ask.
- Missing phone, opt-out, missing review URL, or an explicit skip creates a visible reason rather than a false sent record. A later retry uses the original request.

### P10 - Review and maintenance follow-up

Maintain a per-customer/job message history. Completion prepares one primary review request for the service encounter. A multi-vehicle job has one customer request, not one per vehicle. Additional requests require a deliberate owner action with duplicate warning. Review receipt/rating tracking is manual unless a future integration supplies evidence.

Maintenance uses owner-selected dates/cadences per customer/vehicle. It creates a task or proposed appointment, never automatic billing or a guaranteed fixed price. Due tasks can be completed, snoozed or dismissed. The illustrative 45/90-day timings are not defaults.

Acceptance:

- With no follow-up interval configured, completion creates no invented due date; the owner can set one explicitly.
- Rebooking resolves/snoozes the related reminder only through a linked action; unrelated vehicle reminders remain.
- Opted-out customers are excluded from outreach preparation; administrative transaction records remain intact.

### P11 - Invoice, collect, tip and handle excess money

Build an invoice from accepted commercial scope and approved amendments. Show source traceability, unique invoice number, all-in amount, issue/due dates, credits, allocations and remaining balance. Normal operation is completed work followed by full collection. Required exception handling supports partial and split-method receipts. Record cash, check, Zelle, Venmo, Cash App, PayPal or an explicitly named other direct method with its financial account.

Acceptance:

- Accepted $450 service completed; record $475 explicitly split $450 invoice/$25 tip: invoice balance zero, service revenue $450 and tip revenue $25 in the no-tax test fixture.
- Record $475 without tip confirmation: invoice allocation $450 and customer funds liability $25; no tip is inferred.
- Record $200 then $250 against a $450 invoice: balance progresses $250 then zero without changing original invoice amounts.
- Two concurrent $450 collections cannot both be applied to a $450 balance; excess money is held for resolution rather than lost or forced into revenue.
- A pending/unverified transfer does not mark the invoice paid. A check recorded as physically received may settle the invoice into undeposited funds; later dishonor reverses it and reopens the balance.
- Recording payment cannot claim Crest OS moved external funds. The user confirms receipt, method, time and account.

V1 supports mixed-channel business custody and explicit owner funding; actual channel ownership is verified privately before activation. ACCOUNTING section 26 defines business-only owner custody, excluding personal balances/activity, and explicit owner funding/distributions. A dedicated business account is not an assumed prerequisite already satisfied. P11 acceptance must demonstrate a $475 Crest receipt in a mixed wallet producing $475 custody (or $465 custody plus $10 evidenced fee), not the wallet's entire balance, owner contribution or a fictitious bank deposit.

### P12 - Refund, reverse and reconcile

the owner can record a full/partial external refund with funding-origin and descendant links (including approved opening funds and nonposting legacy evidence), amount, date, reason and classification. The UI distinguishes reducing a customer's charge, returning excess funds, returning a tip, and reversing a failed/erroneous payment. Reconciliation matches bank/payment-service statement records to existing money events before offering new posting.

Acceptance:

- A service concession on a paid $450 invoice followed by a $100 refund leaves the customer owing zero and reduces service revenue by $100 in the no-tax fixture; it does not reopen $100 debt.
- Reversing a bounced $450 payment reopens $450 due and reverses cash, without reversing the earned service revenue.
- Returning $25 accidental excess reduces the funds liability and cash, with no change to service/tip revenue.
- Refunds cannot exceed available refundable funds across prior refunds and reversals. Duplicate import/payment references are flagged and retries do not post twice.
- Transferring $500 from Venmo to bank changes asset accounts, not revenue. A fee is separately identified and reconciled: embedded in the transfer event or a separate fee event, never both. Transfers spanning dates remain in transit until evidenced arrival/return.

P12 additionally distinguishes failed incoming collections (reopen surviving AR/funds/tip effects, preserve earned service revenue) from failed outgoing refunds (restore customer liability, preserve the concession). A failed $25 tip refund followed by retry reduces tips once, restores $25 funds when returned and clears those funds on retry. Exact original ranges and funding descendants govern available capacity; original receipt splits alone do not. Actual dishonor credits the actually debited account, including owner custody/personal funding under ACCOUNTING section 26. Erroneous records with no movement reverse the originally recorded account.

### P13 - Expense, receipt and accounting record

Capture vendor/date/gross amount, tax component if known, category, funding account/method, purpose, optional job attribution and one or more receipts. Draft review precedes posting. A receipt can support split classifications; it never creates a second expense by being attached again. Missing receipts are visible and permitted with a reason. Equipment classification unresolved means pending review, not forced expensing.

Acceptance:

- Save a $100 paid supplies expense with a receipt, review and post: one source record links to one balanced journal and retrievable attachment.
- Attach a second image of the receipt: amount and journal remain unchanged. Duplicate vendor/date/total or content hash warns before another posting.
- A mixed personal/business receipt records only explicitly classified business amounts and the appropriate owner treatment; classifications reconcile to the recorded outflow.
- Correct a posted expense through reversal/replacement or an explicit adjustment; original evidence remains accessible.
- OCR, if installed, only proposes fields and cannot post without owner review.

P13 date/funding acceptance: incurred date, actual payment date and unconditional supplier-refund claim date are distinct. Incurred-but-unpaid cost posts to AP; later owner payment settles AP to explicitly chosen contribution or due-owner liability, with no business-bank fiction. Supplier refunds follow remaining cost-origin ranges and current reviewed classification. Asset/prepaid exceptions require their typed schedules and applicable D03 approval, not an engine-wide tax-election gate.

### P14 - Mileage and travel history

Travel records support outbound, between-job, return, supply-run, pickup/return, and other business-purpose legs. Record date/time, origin/destination, purpose, driven vehicle, job links and distance source. Manual measured miles and odometer readings are sufficient for V1. Route estimates remain separate from confirmed actual mileage.

Acceptance:

- A 12-mile actual outbound leg and 14-mile actual return leg report 26 miles, not a doubled 52. A shared leg between jobs is one physical leg.
- An 11-mile route estimate is labeled estimated and excluded from confirmed-mile totals until confirmed/corrected.
- Mileage does not automatically post an expense, tax deduction, or fuel reimbursement. Reports expose raw evidence and classification for review.

### P15 - Bookkeeping and accountant handoff

V1 must have an auditable double-entry general ledger with source-linked invoice, credit, payment, refund and expense postings; account transfers; owner contribution/draws; reviewed opening balances; manual balanced adjustments; reconciliation and period locks. Reports are labeled "Operational books - invoice-issued recognition; not full accrual financial statements." Recognition occurs on explicit issue, not automatic completion. ACCOUNTING.md defines exact postings, controls, original-component corrections, opening items, owner custody and report bridges. Synthetic financial implementation is unblocked. Actual tax/mappings/openings/cutover and applicable asset events remain D01/D02/D03/D12 gated; tax elections are not prerequisites for building the engine.

Acceptance:

- Every posted entry balances; failures roll back the whole source-posting operation. Drafts do not affect reports.
- Invoice issue creates receivable/revenue/tax according to verified configuration; collection settles receivable without recognizing service revenue a second time.
- A locked period rejects a backdated posting; an authorized unlock is explicit, logged and invalidates affected reconciliation/report status.
- General ledger, trial balance, P&L, balance sheet and source subledgers reconcile under BR12/BR14. Financial reports show period, basis, timezone, currency, generation time and completeness warnings.
- Unreviewed opening balances or imported history cannot be presented as a complete company balance sheet or lifetime profit.

P15 control acceptance also requires funding-root conservation, receivable-item AR, exact tax/discount range restoration including non-last credit reversals, transfer transit, AP/owner/asset/prepaid/suspense controls and immutable control mappings. Include originals and reversals by their effective dates; openings and derived accumulated earnings count once. Completed-but-unbilled coverage derives from completion and scope entitlements even if an invoice draft is deleted.

### P16 - Dashboard and reporting

Home prioritizes today's appointments, active travel/work/custody, overdue invoices, due lead/maintenance follow-ups, incomplete mileage, failed uploads, unreviewed imports, excess customer funds, unposted financial items and backup failures. Report views support today/week/month/year-to-date/custom dates, with documented date basis and drill-through.

Required metrics: net service revenue, tips, cash received/refunded, outstanding receivables, posted expenses/book net income, scheduled contracted value, completed jobs, average ticket, discounts, cancellations/reschedules, lead source/conversion, new/repeat customers, customer service revenue, service/category/geographic breakdowns, active/travel time and confirmed versus estimated miles. Job contribution and revenue/hour require explicit allocation/completeness rules in BR14.

Acceptance:

- Dashboard totals equal report totals with identical filters and can be traced to their source records.
- A partial payment changes collections and balance, not invoiced revenue. Tax payable and customer overpayments never inflate revenue.
- Missing timing/cost/allocation produces an unavailable or qualified metric, never an apparent zero-cost/high-profit success.
- Historical revenue, review counts and other context figures are never seeded as live metrics.

### P17 - Import, export and recover

Use staged imports: upload, map, validate, preview duplicates and effects, owner approve, execute, error report, reconcile. The initial legacy migration is contact/vehicle only; generic reference-history staging remains nonposting. Historical ledger import is excluded. Unknown vendor formats require mapping rather than guessed columns. Bank/payment CSV staging must allow match, split, transfer, exclusion, or reviewed new transaction. Historical operational records and opening accounting entries are different import classes.

Required exports include all implemented relational entities and audit/configuration versions in CSV, analysis/accountant Excel workbooks, and professional PDF P&L/balance sheet/ledger/revenue/expense/mileage reports. Offer secure batch attachment download with IDs/checksums/manifest; an all-in-one ZIP is not required. No opaque attachment URL may be the only portable representation.

Acceptance:

- Import the same source batch twice: second run cannot duplicate accepted rows. Invalid rows report their row number/reason and cannot leave broken relationships.
- Import historical paid jobs in reference mode: history is visible but no current revenue or receivable posts. Accounting cutover reconciles separately.
- CSV/Excel exports preserve IDs, parent links, timestamps, amounts, statuses, provenance, tax fields and revision relationships; exports are protected from spreadsheet formula injection.
- Report totals reconcile to exported ledger/source data at the same consistent snapshot. Large exports cannot silently truncate.
- Restore a backup in a restricted recovery environment, including photos/receipts, and verify ledger balances, links, authentication configuration and application compatibility before production launch.

## 4. Experience and reliability requirements

### P18 - Mobile

Required: no horizontal scrolling for primary tasks at 360 CSS-pixel width; primary touch targets at least 44 by 44 CSS pixels; readable contrast; labels beyond color; camera/gallery upload; persistent visible save/upload state; quick search; call/text/directions; prominent current job; minimal re-entry. Use device-local drafts only when clearly labeled unsaved and protected from other users; never claim offline financial posting. Do not require interaction while driving.

Acceptance: complete P02-P14 on a supported phone browser with synthetic data; rotate/reload/background the browser during travel and timing without lost committed state. Disconnect before/after payment submit: show uncertain status and resolve by idempotency key before offering another receipt. Opening the messaging app must not lose unsaved job changes. Keyboard and screen-reader users can complete critical forms and understand validation.

### P19 - Desktop

Required: full feature parity, keyboard-friendly forms, filterable/sortable tables, calendar, multi-line quote builder, receipt review beside expense fields, import previews, reconciliation and report/export controls. No critical function depends on a mobile-only gesture or camera. Desktop has sufficient density for money review without hiding balances or warnings.

Performance acceptance: on a declared mid-range phone and throttled mobile-network test profile, ordinary text-only navigation and saves at the pilot dataset must show an outcome or progress within 3 seconds at the 95th percentile. Large uploads/exports may run longer with progress/retry. Architecture review must record the exact device/network/dataset used, plus a test at 10,000 customers and 50,000 jobs. Failure requires optimization or an explicitly documented capacity limit before rollout; it must not be hidden behind a generic fast claim.

### P20 - Opt-in Google Calendar connection and automatic outbound schedule view

Required V1 capability, optional owner activation. After an explicit owner connection and shared-field preview, automatically publish confirmed appointments into a dedicated app-created Google calendar visible alongside the owner's other calendars. Crest remains authoritative; Google edits never confirm/reschedule/cancel work, change money/custody or reserve personal busy time in Crest. No two-way sync, primary-calendar write, guests/invitations or imported personal calendars in V1.

Acceptance: current source-version sync state and last confirmed time are visible; confirmed reschedule updates the same mapped event and cancellation removes the external active reservation while retaining source history. Failures preserve the internal schedule and expose Pending/Delayed/Reconnect required/Review needed honestly. Exact timestamps/timezones and minimal payload preview, optional client/service/address disclosure, least Google scopes, encrypted server credentials, duplicate/uncertain-result reconciliation, external-edit review, disconnect and restore fencing, exports and synthetic actual-Google acceptance are required. No paid intermediary or overage is assumed. See BR21, ADR35 and TESTING GC01-GC18. This feature's implementation follows the scheduling/recovery prerequisites; writing this requirement is not a completion claim.


## 5. Open decisions and activation gates

| ID | Unresolved decision / owner | What can proceed | What is blocked until resolved |
|---|---|---|---|
| D01 | Verified tax applicability, inclusive calculation rules, effective dates and treatment of services/tips/credits; the owner with qualified adviser | Schema, drafts, synthetic tax tests, CRM/workflow | Production financial invoice/credit posting with unknown treatment; unknown is not zero |
| D02 | Chart of accounts, mappings, opening balances, cutover date, completeness; the owner/accountant | Ledger engine and synthetic postings | Primary-system financial launch and claims of complete financial statements |
| D03 | Accounting/tax elections and asset policy; the owner/accountant | Synthetic invoice-issued operational ledger and cash movement reporting; reviewed per-event asset classification | Tax filing and automated depreciation excluded; unresolved real asset posting gated; tax elections do not block synthetic financial implementation |
| D04 | Cancellation/no-show terms and fee activation; the owner | Cancellation/reschedule records, fee fields | Automatic fees; no $50 default |
| D05 | Custody/authorization requirements; Mobile and Drop-Off already enabled, Pickup + Return separately gated | Build/test all modes; operate enabled modes with configured requirements | Pickup + Return offering without explicit enablement; missing configured acknowledgements; no inferred insurance/legal sufficiency |
| D06 | Public package names/prices/copy; the owner | Owner-edited catalog and reviewed custom quotes | Automatic promises derived from historical examples |
| D07 | Travel recommendation formula and default origin; the owner | Manual estimates/adjustments, >35-minute prompt | Computed dollar recommendations without a versioned owner-approved rule |
| D08 | Maintenance cadence, membership packaging, winter SOP; the owner | Manual follow-up dates and flexible scheduling | Default 45/90-day outreach, automatic contracts, winter guarantees |
| D09 | SMS/card provider, AI/OCR inclusion; the owner | Native messaging, manual payment/expense intake | Automated messaging, direct cards, autonomous AI actions |
| D10 | Backup infrastructure, restore procedure, capacity, monitoring and retention funding; architecture review with the owner | Design against BR17 minimums | Real-data pilot without a successful restore and operating backup controls |
| D11 | Authentication implementation, session policy, file limits, security/privacy retention schedule; architecture review with the owner | Use BR01/BR16 baseline requirements | Production release without explicit settings and tested recovery/revocation; destructive retention automation without approved schedule |
| D12 | Exact prospective cutover and supported opening/coverage evidence, even without historical migration; the owner | Contact-only staged import and synthetic opening validation | Primary cutover with unknown required balances; bounded non-primary pilot requires verified balances for every item/account used |

These gates distinguish architecture blockers from activation blockers. The generic schema/state machines can be implemented now. Tax/accounting cutover cannot be made financially safe through a vague manual override. Pickup workflow design is explicitly allowed by context; this specification does not invent a legal policy or a claim of coverage.

## 6. Critical review of the supplied context

| Finding / source sections | Risk | Resolution in this specification |
|---|---|---|
| Immediate review ask at completion (§22-23) versus payment-then-review narrative (§5/§59) | Review delayed or duplicated | Completion triggers the ask independently of payment |
| Paid and follow-up included in one job lifecycle (§22) | Refund erases completed-work state; custody hidden | Separate work, financial, outreach and transport states |
| Automatic mileage aspiration (§36) versus PWA/low-cost design (§50-52) | Browser background behavior creates invented miles | Persist travel events; actual/manual and estimated distance explicitly separated |
| Native messages and sent tracking (§23-25) | Opening SMS app falsely treated as delivery | Preparation/opened/manual-confirmed-sent are different evidence levels |
| Unresolved tax called non-blocking (§37/§65) | Balanced books may still misstate revenue/tax | Configurable model, but tax configuration gates production posting |
| Basic accounting foundation versus full financial reports (§38/§45/§55) | Attractive but incomplete balance sheet/profit | Required minimum ledger, openings, reconciliation and completeness labels; no full tax suite |
| Pickup exists before legal policy (§27) | Completion confused with return; implied authorization | Pickup + Return disabled, Drop-Off enabled by dated owner decision; separate custody and explicit enablement |
| Price ranges in current and historical sections (§10/§63) | Ranges become false minimums; older exterior prices override current context | Store guidance only; manual reviewed prices; no inherited promotion |
| Extraction in condition examples and paid add-on (§9-11) | Double charging | Explicit scope inclusion and no duplicate charge for the same work |
| Multi-vehicle quotes without fulfillment/billing allocation (§14) | Repeated invoicing, misleading per-service profitability | Line allocations to jobs/invoices with limits and explicit bundle allocation |
| Gross/contribution/net profit and CLV requested broadly (§44) | Missing costs/tax/owner labor presented as precise profit | Defined book income, qualified contribution and observed lifetime revenue; predictive CLV deferred |
| Backup restore testing described as eventual (§46) | Only discover broken backups after loss | Demonstrated restore before real pilot, repeated drills |
| Import/update intent (§20/§39/§54) | Auto-merge or duplicate historical revenue | Staging, owner review, reference-history mode and cutover reconciliation |

Scope pressure: defer OCR/AI, map automation, automated recurrence, customer accept links and the asset UI before cutting ledger integrity, exception handling, exports or recovery. Financial reporting and three fulfillment modes make V1 materially larger than a CRM. They remain because the requested scope expressly includes them; implementation should deliver vertical slices, not a large simultaneous build.

## 7. Release sequence and definition of done

Suggested implementation sequence (not authorization to code): CRM/access → reviewed quotes and acceptance → scheduling/mobile/transport/timing/photos → financial engine with synthetic fixtures → invoices/collections/expenses/reconciliation → reports/exports/imports/recovery → integrated pilot. Test each slice before building dependents.

Required release gates:

1. D01/D02/D10/D11 and applicable feature gates resolved and documented. D12 applies to every actual opening/cutover used by a bounded non-primary pilot, including a prospective start without historical migration; primary-system cutover requires the full evidenced opening/coverage plan. No unresolved behavior is hidden as a zero, false, guessed identity or default policy.
2. P01-P19 and BR acceptance fixtures pass, including concurrency, duplicate submissions, partial failures, locked periods and negative authorization tests.
3. Type checks, lint, automated tests, accounting integrity, migration/database integrity, security checks and production build pass. A failed accounting invariant blocks deployment.
4. Database and object restore succeeds with reconciliation; exports are usable outside Crest OS; pending/failed uploads and backup failures are visible.
5. Synthetic-data break testing precedes real-data pilot. Pilot approximately 5-10 customers only after security/backup gates, compare against source records and reconcile every invoice/payment. Do not declare cutover complete until discrepancies are resolved.
6. A rollback/recovery procedure, migration strategy, owner operation guide and support/error monitoring exist. Real customer data never becomes routine development test data.

## 8. Second-pass adversarial review - incorporated corrections

This review treated both documents as durable production contracts, not just happy-path descriptions. Corrected: stale quote acceptance; accepted-scope amendment races; duplicate billing across multi-vehicle jobs; refund versus failed-payment confusion; overpayment liabilities; clearing-account transfers; current CRM edits rewriting historical counterparties; browser timer/mileage assumptions; duplicate review asks; unfinished custody after cancelled work; invisible upload loss; incomplete financial statements; import/opening double counting; timezone and rounding inconsistencies; CSV injection; database-only backup claims; and permission checks limited to UI.

Residual limits are explicit: tax/legal/accounting elections remain owner/adviser decisions; background GPS and SMS delivery are not promised; indirect job costs and historical completeness cannot be inferred; the adopted infrastructure choice is in ARCHITECTURE.md, subject to measured provisioning gates. An engineering agent may implement the specified deterministic behavior but must stop the gated feature at the named decision rather than invent the missing policy.

## Owner decisions recorded 2026-10-20

- Current requested expenditure is $0; earlier production estimates remain historical planning. Use free services only where they preserve required behavior. The budget pilot and its capacity/availability tradeoffs are specified in ARCHITECTURE section 9. Cost does not authorize permanent data loss, accounting shortcuts or weaker access controls.
- Recovery, security and backup alerts go to the privately configured owner alert mailbox. Verify ownership and actual delivery; do not send secrets/backups as email attachments. Independent monitor/provider notices must also target this mailbox. No messages or account changes were made by documenting this decision.
- Password plus authenticator TOTP; remember trusted phone/desktop sessions for up to 30 days, expiring after seven days without foreground use. Opening the app does not require a new login. Sensitive export/security/period-unlock actions can require recent authentication. Device loss, recovery or revocation can end a session earlier. Require a unique Crest password; strongly recommend a different unique mailbox password and mailbox MFA. No paid password manager required. An offline sealed recovery kit must include provider recovery material and backup decryption keys, held separately from the phone/email/app; test recovery without the phone. Mailbox-only reset must not bypass TOTP.
- Backups every six hours; 30 daily and 12 month-end points plus referenced originals. Continue financial writes after a 24-hour backup failure with persistent in-app and external email alerts; record the RPO breach. Do not destroy records to meet a storage cap. Retention is provisional preservation, not a legal retention opinion.
- Real duplicate prevention uses stable command identity and verified provider transaction IDs. Same customer/vehicle/service, even on the same day, is not unique payment identity. Flag same-customer/same-amount/same-method/same-business-date receipts for review; display candidate details and allow an explicit reason to confirm a distinct receipt. Flagging never automatically refunds, merges, deletes or rejects a legitimate transaction. Repeated service on a new job is valid; invoice entitlement controls prevent billing the same fulfilled scope twice. Deterministic rules suffice; no AI model required.
- Fresh prospective accounting start; no historical ledger import. ACCOUNTING specifies cutover sequencing and opening controls; actual local cutover date/time and evidenced amounts remain owner activation inputs. Fresh start is not permission to assert zero cash, unpaid invoices, deposits, debts or assets. Import reviewed legacy customers and their vehicles/contact details through preview/mapping/reconciliation, with no financial posting. Preserve source batch and identifiers; no guessed field mapping or automatic merges.
- Mobile and Customer Drop-Off enabled at launch. Pickup + Return remains separately gated. Existing condition/custody/acknowledgement requirements still apply; enabling a mode does not establish insurance or legal sufficiency.
- Accountant-ready period reports and evidence: general ledger, trial balance, profit/loss, balance sheet, receivable/payable/customer-fund controls, reconciliation, invoices/receipts, mileage, asset register and corrections/export history. ACCOUNTING defines supported reports and exact reconciliation; coverage warnings remain mandatory. Formal tax returns, tax advice, filing and automated depreciation are not promised; the tax preparer determines filing outputs. Prior-period records remain separately accessible for the tax preparer and are not erased by the fresh start.

This dated owner amendment controls the affected defaults and D05/D10/D11/D12 gates. All other requirements/invariants remain in force. No production gate is marked passed merely by documenting a decision.
