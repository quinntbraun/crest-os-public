# Crest OS V1 - Business Rules and Invariants

Version: 1.4 | 2026-10-22 | Owner-requested V1 Calendar contract; implementation and production gated

Calendar scope amendment, 2026-10-22: the owner requested Google Calendar connection support in V1. P20/BR21/ADR35 now require the capability with optional owner activation, outbound-only projection and unchanged integrity/security/recovery gates. This supersedes older optional/excluded Calendar wording only. Current versions and immutable-baseline amendment evidence are in CANONICAL_MAINTENANCE.md; implementation/research and unexecuted provider gates are in [the Calendar contract](../planning/GOOGLE_CALENDAR_V1.md). No live integration or production approval is implied.

Public edition, 2026-10-20: owner-authorized public source; application access and business evidence remain private. PUBLICATION.md records this explicit privacy/provenance amendment and the current authority/version register. Earlier private-repository and budget/authorization statements below are historical where superseded there. No security, accounting, recovery or real-data activation gate is waived.

This is the canonical V1 specification baseline adopted by the 2026-10-20 reconciliation request, not evidence of software completion or approval of unresolved real-world policies. Source precedence remains current repository documentation and explicit current decisions, the owner's latest explicit statements, CREST_CONTEXT.md, historical examples, then public copy. PRODUCT owns scope and outcomes; BUSINESS_RULES owns operational invariants; ACCOUNTING owns specialized posting, control, reporting and owner-custody semantics; DATABASE/ARCHITECTURE/SECURITY/TESTING/EXPORTS_AND_BACKUPS implement those contracts. Specialized accounting authority does not override unrelated product or security decisions. A future true conflict requires an explicit documented amendment before affected implementation. All canonical versions are dated 2026-10-20; PRODUCT/BUSINESS_RULES 1.2, ACCOUNTING 1.4, technical companions 1.3.

## BR00 - Authority and common contract

Apply the source precedence in CREST_CONTEXT.md §0: current repository documentation/explicit current decisions, latest explicit owner statements, consolidated context, historical examples, then website. PRODUCT.md defines V1 scope and decision register D01-D12. This file specifies required behavior. A conflict between the two documents requires correction, not silent precedence. The reconciled package includes ACCOUNTING.md 1.4 as the specialized accounting contract and the current technical companions; CREST_CONTEXT remains contextual.

**MUST** is mandatory; **MAY** is optional within scope. Rules marked implementation convention are documented product decisions derived during specification, not claims of a pre-existing Crest policy. Unresolved financial/legal treatment is never established by an override button.

### BR00.1 - Identity and relationships

Use stable opaque IDs independent of names, phone numbers, invoice numbers and filenames. Historical references must survive rename/archive. Every owned record has business identity, creation actor/time and provenance. Every financial/source event has effective date, recorded timestamp and source link. Timestamps are UTC instants plus the relevant business timezone; dates such as invoice/accounting dates remain explicit local dates. Store appointment timezone so later settings changes do not shift bookings.

Conceptual relationships (schema design must preserve these, but table names are not prescribed):

| Record | Required relationship and meaning |
|---|---|
| Lead | Opportunity; may link to an existing customer; conversion mapping retained |
| Customer | Counterparty; multiple addresses and vehicles; may have multiple opportunities |
| Vehicle | Stable vehicle identity; current customer association plus historical associations |
| Quote family/revision | Opportunity/customer, immutable issued versions, item-level vehicle and scope |
| Acceptance/amendment | Exact offered revision and evidence; preserves original agreement |
| Job | One customer, one fulfillment mode and work location per visit; one or more vehicles; allocated accepted scope |
| Appointment history | Job, previous/new schedule, reason; one current confirmed appointment |
| Travel leg | One physical movement with driven vehicle, purpose, endpoints and optional job links |
| Work interval | Job, start/end, active or paused; operator attribution |
| Custody event | Vehicle, job, transfer action/time/recipient/location |
| Invoice/credit | Customer, immutable issued lines, accepted-scope/job allocations, accounting source |
| Payment | One real incoming receipt; method/account, customer, invoice allocations, tip and customer funds portions |
| Refund/reversal | Original payment/source, explicit classification, amount, reason and accounting link |
| Expense/receipt | Expense splits and funding; receipt file(s) are evidence, not transactions |
| Journal entry/line | Balanced immutable posting linked to source; reversing/replacement links |
| Attachment | Private object identity, checksum, metadata, upload state, entity links |
| Message/follow-up | Purpose, recipient, source job/lead/vehicle, evidence state and suppression reason |
| Import/batch row | External source identity, fingerprint, decision, result and reconciliation |

V1 does not support joint invoices across unrelated customers or a fleet hierarchy. A household may be represented by one agreed billing customer or distinct customers sharing contact details. Never infer identity from shared email/address alone. Customer-vehicle ownership changes preserve job-time customer associations and financial snapshots.

### BR00.2 - Atomicity and retries

Every mutation that creates a financial record, converts a lead, accepts a quote, starts/ends a leg or timer, completes work or schedules a job must accept a stable operation identifier. Within an unchanged business recovery epoch, retry with the same ID and same payload returns the prior result; reuse with a different payload fails. Enforce business uniqueness in addition to retry keys so new keys cannot bypass duplicate acceptance/billing limits. Concurrent writers use version checks/transactions; stale edits fail with a reload/review action.

Source posting and its ledger entries commit together or neither commits. Completion and creation of its pending follow-up/review task commit together. External effects such as opening messaging, uploading files or generating PDFs must be retriable after commit and cannot roll back already confirmed work. Separate pending external outcomes from completed local transactions. Do not claim success on an unknown response; resolve by operation ID.

All mutations and background finalizations must validate recovery authority inside their transaction before returning a retry result or changing state. Old-epoch operational commands are rejected as well as financial commands; no automatic refresh of a queued command to the new epoch. ARCHITECTURE section 5 defines the shared-lock fence and recovery drain. Ordinary session revocation remains next-request revocation; restoration has the stronger explicit write fence.

### BR00.3 - Precision

USD only in V1. Store money in integer cents; no binary floating-point financial arithmetic. Percentages use fixed-precision decimals. Use decimal round-half-up to cents at the explicit calculation boundaries in BR04/BR12. Intermediate calculations retain precision. Each account/posting currency must match USD; reject unsupported currency rather than convert implicitly. Durations use seconds; distance retains at least 0.01 mile precision. Round for display without replacing underlying measurements.

## BR01 - Authentication and permissions

Required permissions are initially all assigned to the owner's provisioned owner identity: manage CRM/catalog/schedule, approve/send quotes, record acceptance, operate jobs, post/reverse financial events, configure settings, review imports, reconcile/lock periods, export and initiate recovery. No employee role builder is required. Service processes receive only needed privileges; browsers must never receive privileged database or storage credentials.

All read/write/file/export operations enforce authentication and business ownership on the server/data boundary. Object URLs are private, short-lived and scoped; path guessing is not authorization. Optional customer quote links expose only that revision's customer-safe projection and explicitly allowed action, not CRM access. They are unguessable, revocable, expiry-controlled and invalidated for superseded offers. A bearer-link acceptance is evidence of link possession, not verified identity or a certified signature; retain that distinction.

Adopted SECURITY session baseline (D11 implementation proof remains required): trusted sessions have a maximum 30-day lifetime and expire after 7 days of inactivity; untrusted sessions expire after 12 hours. Revocation/logout take effect on the next protected request. Exporting bulk sensitive data, changing authentication/recovery configuration, unlocking periods and production recovery require reauthentication within 15 minutes. These are security settings, not permanent commercial rules; changes require an explicit security decision; this reconciliation does not relax them. Rate-limit authentication and recovery; never disclose whether an unverified email exists. Recovery must verify the owner through the selected provider, invalidate compromised sessions and preserve audit history. No unauthenticated public registration.

Normal daily phone use should not require authentication on every job transition. Lost-device revocation and owner recovery must be tested before launch. Audit sensitive actions without logging passwords, tokens, message credentials or full signed URLs.

## BR02 - Leads, conversion, customers and addresses

### BR02.1 - Minimal records

A lead requires a nonempty identifying label; contact may be absent. Name, phone/email, requested service, availability, source, referral, address, vehicle details, condition notes/photos, estimated value and follow-up date are supported but not universally mandatory. Normalize contact values for search without discarding original input. Invalid contact values cannot be used to launch/send communications. Unknown source is a legitimate value, not an invented referral.

A customer requires a nonempty display name and stable ID. Scheduling requires a confirmed contact route or explicit no-contact reason, exact work location, and identifiable vehicles. A vehicle can use a descriptive label when year/make/model are unknown. VIN/plate/color are optional; do not invent or require them. Dates/year plausibility checks may warn; known unusual vehicles must remain recordable.

An address includes structured fields where available, free-text instructions, optional coordinates and geocode source/accuracy. A manually verified exact location may substitute where no postal address exists. Work location, billing address, pickup location and return location are distinct concepts. Geocode results never silently overwrite owner's address. Changes after acceptance require commercial review if price/scope/travel changes; ordinary appointment logistics can be updated with history without rewriting the accepted location snapshot.

### BR02.2 - Lead states

States: New, Contacted, Awaiting Information, Quote Needed, Quote Sent, Follow-Up, Won, Lost. Owner may move among nonterminal states with an event; Lost requires a reason and can reopen with reason to Follow-Up or another applicable active state. Accepted quote sets Won; Won is not the same as paid or completed. A later cancelled job remains historically won with a separate cancellation outcome. Reopening a Won opportunity requires reason and never removes the acceptance; a new independent request should normally be a new lead.

Quote Sent is set by a confirmed sent event and not by drafting. Customer conversion alone does not set Won. Lost leads can retain a future follow-up. Declining one quote does not necessarily lose the lead; owner decides. Scheduling without accepted commercial scope is disallowed for confirmed customer jobs; prospective holds are explicitly unconfirmed calendar notes, not jobs counted as contracted work.

Conversion is atomic and repeatable: link/create customer; link/create selected vehicles/addresses; retain source lead, original notes and attachments; link existing quote family rather than clone it. Owner chooses duplicate matches. Automatic record merges are excluded. An accidental duplicate may be archived and explicitly linked to the retained record; reassigning active references requires review and must not mutate financial snapshots.

## BR03 - Catalog, category, condition and guidance

Initial vehicle categories: Two-door/small coupe; Sedan; SUV; Truck; Large SUV/minivan. Initial condition classes: Light, Moderate, Heavy, Extreme. Owner can override an assigned vehicle category with a note; historical quoted category/condition remains snapshotted. Condition is observed per assessment/job, not an eternal vehicle attribute. Distinguish reported, photo-assessed and on-site observations with time/source.

Light means baseline ordinary maintenance; Moderate means meaningful routine buildup; Heavy means substantial added labor; Extreme means outside predictable production assumptions. Extreme requires an owner review acknowledgement before an offer is approved and an on-site safety decision when relevant. No AI or condition classifier can approve hazardous work. Record decline/stop reasons; never imply Crest is a biohazard remediation provider.

Services have stable ID, active flag, name, customer-facing scope, exclusions, internal guidance, optional starting range/duration and version. Archive instead of deleting used services. Historical descriptions and price snapshots do not change with catalog edits.

Current scope constraints:

- Applicable leather cleaning/conditioning belongs in interior service, not an automatic add-on.
- Exterior sealant/protection is included only if the selected scope says so.
- Normal odor work is included; severe odor may add reviewed scope; no guaranteed elimination.
- Pet hair and extraction are discretionary, commonly about $50; severe extraction may be about $100. These are suggestions, not automatically applied charges.
- Engine bay is variable; headlight restoration guidance is $75-$100. Decontamination/wax/sealant/correction/coatings are higher service or specialty scope, not automatic cheap add-ons.
- No hard interior/full/heavy minimum or maximum is inferred from approximate ranges. The temporary educator discount is inactive unless the owner deliberately creates/enables a template.
- Prevent accidental duplicate billing for extraction/pet hair or other work already included in a package. A knowingly distinct extra scope must be described and reviewed, not just added by condition inference.

## BR04 - Quote pricing, discounts and travel

### BR04.1 - Line model and formulas

Every offered monetary line belongs to a customer, vehicle or explicit job-wide scope. V1 uses quantity 1 for a flat scoped service line; additional vehicles/services are separate lines. No measured hourly or usage-based billing engine is required. Store customer-facing description and inclusive amount, with internal component breakdown where used. Internal pricing guidance is not a second amount charged to the customer.

Let `B_i` be each nonnegative line's all-in gross amount after positive/negative owner price adjustments and embedded travel but before discounts. A negative discretionary adjustment must not drive a line below zero; no arbitrary negative invoice items. Use explicit discount/credit mechanisms instead. A final-total override is represented as an owner adjustment, allocated to lines, then recalculated and reviewed; it cannot be a disconnected number that disagrees with the details.

Discounts can be fixed-dollar or percentage, from active templates or custom. For deterministic V1 calculation: at most one applied discount per line and one applied quote-wide discount. Multiple commercial reasons may be described in the same combined discount; do not silently stack templates. This is an implementation simplification, not a new discount eligibility policy.

1. Compute each line discount `L_i`, rounding a percentage of `B_i` to cents. Require `0 <= L_i <= B_i` and percentage between 0 and 100 inclusive.
2. `N_i = B_i - L_i`; `S = sum(N_i)`.
3. Compute quote-wide discount `D` as entered cents or rounded percentage of S; require `0 <= D <= S`.
4. Allocate D to eligible lines proportional to N_i using largest remainder in integer cents; break remainder ties by stable line order/ID. Owner may explicitly exclude travel or another line from eligibility; then S for this discount is the eligible subtotal. Keep eligibility in the snapshot. No allocation can exceed the line's remaining value.
5. `A_i = N_i - allocated_D_i`; customer total `T = sum(A_i)`; taxable/non-taxable internal splits follow BR12. No later checkout tax is added to T under the current flat all-in policy.

Zero-value lines/offers require a complimentary-work reason; a zero invoice can be settled with no fabricated payment. Unused discount templates never apply themselves. Suggested/actual amounts are stored separately; discount reasons are optional per context, but changes affecting an already issued commercial document require a revision/reason. Reporting counts discounts once from issued invoice snapshots, not quote plus invoice.

Fixture: B=$250/$300; quote discount $25; allocations $11.36/$13.64; final $238.64/$286.36; total $525. Another: $100.01/$100.01/$100.01 with $10 discount allocates $3.34/$3.33/$3.33 in stable order. A 10% line discount on $100 then a 10% quote discount gives $81, not $80. Full discount yields zero without divide-by-zero.

### BR04.2 - Travel

Capture estimate origin, destination, calculation/manual source, departure assumption, estimated one-way and round-trip minutes/miles and timestamp. Route information is optional, not a guarantee. Rough 20-mile area is guidance, not a hard service boundary. Up to 25 minutes is normally included; 26-35 minutes remains discretionary; more than roughly 35 minutes prompts review. Threshold uses the estimated one-way drive time for the visit; round-trip economics inform the owner's decision. Exact monetary recommendation remains D07.

Owner chooses included/waived/explicit adjustment/embedded adjustment, with actual amount. A shared multi-vehicle trip must not automatically multiply travel by vehicle count. Estimated labor, nearby jobs and total value may be shown internally; no dollar formula is silently inferred. A changed destination/time estimate cannot retroactively alter an accepted price. Missing estimates stay unknown and cannot become zero cost in profitability.

## BR05 - Quote lifecycle, approval and amendments

Quote content includes recipient and contact snapshot, vehicles, condition assessment, work location, line scopes/amounts, discounts, all-in total, inclusions/exclusions, terms and optional proposed scheduling/expiry. Internal notes and cost assumptions are separately marked and excluded from the customer projection. Approved rendering/template version or immutable customer-safe representation must be retained so historical acceptance can be reproduced.

Use a revision state plus events rather than several overlapping flags:

| Current state | Action → result | Preconditions/effects |
|---|---|---|
| Draft | Submit → Ready for Review | Complete customer-facing scope and totals |
| Ready for Review | Edit → Draft | Invalidates prior approval |
| Ready for Review | Approve → same state, approval recorded | the owner approves exact content/version; Extreme reviewed |
| Approved review revision | Confirm sent → Sent | Actual sharing confirmed; freeze revision; newer draft alone is not sent |
| Sent | View event → remains Sent | Optional evidence; Viewed is a UI indicator, not acceptance |
| Sent | Accept → Accepted | Exact revision, current offer, unexpired if expiry set, recorded customer confirmation |
| Sent | Decline → Declined | Record customer response; no deletion |
| Sent | Send replacement → Superseded | Atomically activate replacement revision |
| Draft/review/Sent | Cancel → Cancelled | Reason; no acceptance exists |
| Accepted | Amend via new offer | Original remains Accepted forever |

Optional expiry is checked server-side at acceptance; expired Sent can display Expired eligibility without inventing acceptance. No default expiry. Declined/Cancelled/Superseded revisions cannot be reopened for acceptance; issue a new revision. Before sending replacement, UI warns that the previous sent offer is being withdrawn. If old offer accepts first, the attempted replacement must become an amendment flow or fail for owner review.

Acceptance record: revision ID and content fingerprint, customer/counterparty, effective confirmation time, recorded time, recording actor, channel (text/phone/email/in-person/optional link), evidence attachment or factual reference/note. Manual acceptance must identify which terms the customer confirmed. Owner approval is never substituted for customer acceptance. No requirement for a paid e-signature service.

Post-acceptance amendment stores parent accepted version, changed scope, revised total and delta, owner review and separate customer acceptance. One pending amendment chain is sufficient in V1. It applies only if the expected prior agreement version is still current. Unaccepted amendments have no billable effect. Accepted history remains intact; cancellation is an operational event, not reclassification of original acceptance. If a change affects an issued invoice, use a supplemental invoice or credit against the impacted lines, never silently rewrite it. Negative amendments cannot reduce contracted amounts below already credited/refunded limits; review existing allocations atomically.

## BR06 - Scope allocation, scheduling and cancellations

Allocate accepted quote lines to job/vehicle scope and to invoice lines. A flat quote line may be split across visits only through explicit owner allocation of amount and scope; allocations sum to the accepted amount. Allocation alone cannot change customer obligations: partial cancellation of a bundle, a new installment obligation, or a disputed partial-service amount requires an accepted amendment or approved charge reduction before billing. Each job is one visit at one work location. Multiple jobs can link one agreement; multiple vehicles may share one job. Track authorized, completed, cancelled, billed and credited scope so retries or multiple jobs cannot invoice the same entitlement twice. Accepted amendments revise remaining entitlement without altering prior events. A credit does not automatically replenish billable entitlement; replacement requires atomic correcting credit, consumption transfer and replacement issue under finance/family locks, or the predecessor consumption remains reserved until the successor is ready. Transfer each predecessor slice once; preserve zero-dollar scope identity. Reversing a predecessor credit is rejected until its successor chain is atomically resolved. Net cumulative billed value must remain within completed authorized scope.

Confirmed Scheduled job requires: accepted scope, linked customer/vehicles, fulfillment mode enabled, exact work location, scheduled start/timezone and positive estimated duration, customer confirmation, and contact route/no-contact reason. No unpriced confirmed job by default. Urgent work may use a rapidly recorded owner-reviewed offer and customer acceptance; it may not bypass that evidence.

Calendar conflicts compare current scheduled time intervals plus known travel buffers against other jobs for the sole operator. Unknown travel prompts a warning. Override requires reason; it does not change existing appointments. Tentative proposals are not contracted scheduled revenue. A schedule change retains before/after timestamps, actor/reason and confirmation status; revised proposals are not displayed as customer-confirmed until recorded as confirmed. No recurring job auto-accepts a future price.

Rescheduled is an event, not a terminal work state. Before work starts, rescheduling retains the same job and agreed scope. After a trip begins, first close/cancel the active travel leg with actual evidence; record interruption and reschedule. After work starts, use a pause for resumption of the same scope or end incomplete work and allocate remaining scope to a new visit. Never move actual historical labor into a future appointment.

Cancellation has reason, time, actor and customer-communication status. No fees by default. Future configurable fee requires enabled policy, applicable terms evidence and an approved charge; no automatic $50/no-show/reschedule fee. Cancellation does not delete accepted agreements, travel, work, invoices, payments or custody. If work is partly done, select completed scope and remaining cancelled scope; disputed/changed amounts require amendment/credit review. An invoice balance remains due until explicitly credited/reversed; do not infer refund merely from cancellation. Returned/released custody must still be resolved.

## BR07 - Work state machine, timers and completion

Work state is independent of payment balance, outreach and transport. Required states: Scheduled, En Route (mobile work-site travel), In Progress, Paused, Completed, Cancelled. For non-mobile modes, transport status is separate (BR08). Completion has outcome `full` or `partial`, identifying each fulfilled/unfulfilled scope item; only fulfilled billable scope can enter normal completion invoicing.

| Transition | Required behavior |
|---|---|
| Scheduled → En Route | Mobile only; departure instant; create one open physical travel leg; accept ETA or mark unknown; prepare ETA draft |
| En Route -> Scheduled (interrupted trip/reschedule) | No labor/fulfilled scope yet; close the actual travel leg, preserve mileage/custody, record reason, and atomically confirm replacement appointment with all BR06 prerequisites. Clear unfinished field session and recheck schedule conflicts. If no replacement is confirmed, use the existing cancellation path; no unsupported active state or invented customer confirmation |
| En Route → In Progress via Arrived | Close leg; record work-site arrival; preserve missing mileage task; open active interval automatically |
| Scheduled → In Progress | Drop-off/pickup Start Work after vehicle at work site; mobile direct-arrival exception requires reason and travel omission record |
| In Progress → Paused | Close active interval; open pause with reason |
| Paused → In Progress | Close pause; open active interval |
| In Progress/Paused → Completed | Close interval; completion timestamp/outcome; scope evidence; one pending review request; invoice draft/finalization task |
| Scheduled/En Route → Cancelled | Stop any open leg; reason; retain actual travel/custody |
| In Progress/Paused → Cancelled | Only if no fulfilled scope; close intervals, reason, retain history; otherwise partial completion with remaining work cancelled |

Completed/Cancelled cannot simply reopen. Correct timestamps/outcome through audited correction; additional work becomes a linked follow-up job with explicit charge or complimentary scope. This avoids sending duplicate review requests and rewriting billed completion. Correcting a completion does not delete invoices; any financial impact follows credit/reversal rules.

One active labor interval across the sole operator; one open physical travel leg across the operator. Paused work may coexist with a supply travel leg, but no active labor overlaps that travel. Only one unfinished field work session is allowed in V1; explicitly resolve it before starting another job. Historical time corrections must also preserve non-overlap and chronology. Multi-vehicle labor can remain job-wide; per-vehicle/service metrics require allocation, not guessed division.

Total elapsed = final completion minus first work start; paused time = sum closed pause intervals; active time = sum closed active intervals. For a properly recorded continuous session, elapsed = active + paused. Overnight waiting remains pause elapsed, not labor. Travel is outside job labor. Negative time and interval overlap are invalid. A missing end timestamp is open, not zero duration. Server-confirmed instants are authoritative; manual backdating captures effective and recorded time, reason and original value. A timer view is derived from persisted intervals; browser execution is not the clock of record.

Completion may happen without payment, after partial payment, or with a zero-price service. It must not mark invoices paid. Completion does not require a successful message launch, receipt upload or review; show unresolved items separately. Payment must not force completion. Completed work may still be awaiting vehicle return.

## BR08 - Fulfillment and custody

Modes: Mobile and Customer Drop-Off initially enabled by the owner's explicit 2026-10-20 decision; Crest Pickup + Return initially disabled. the owner enables modes explicitly with recorded date and configured requirements. Build/test does not depend on final insurance/contract language; customer-facing availability cannot activate automatically. Record authorization evidence when configured; missing configured required acknowledgement blocks that transport action. The system never labels an acknowledgement an insurance waiver or guarantees legal protection.

Customer Drop-Off sequence: Expected → Received/In Custody → Work Ready/Started → Work Completed/Awaiting Collection → Released. Receive and release capture time, location, identified handing-over/receiving person, notes and condition photos or missing-photo reason. Start Work is distinct from receiving a car. No Crest travel leg is implied by customer arrival.

Crest Pickup + Return sequence: Pickup Planned → Traveling to Pickup → Collected/In Custody → Transporting to Work Site → At Work Site → Awaiting Return (after work completion) → Returning → Returned/Released. Record actual driven vehicle for each leg, pickup/work/return locations, custody transfer times and recipients. Delays, failed pickup/return and cancellation leave explicit unresolved status and next action; they do not release custody automatically. Vehicle arrival at the work site can offer Start Work; pickup arrival never triggers the detailing timer. Required transport photos may be configured; if optional, record missing-photo reason.

Each vehicle on a multi-vehicle job has its own custody events. If transport requires separate movements, create separate physical legs; do not pretend simultaneous journeys. Work time can be job-wide, but custody cannot. En Route for transport prepares an appropriate pickup/return ETA, not the mobile detailing arrival template. Immediately prepare the review ask at work completion per current rule; owner may defer/skip with reason if the customer has not seen the result. No automatic delayed review schedule is inferred.

## BR09 - Mileage and ETA evidence

Every leg records start/end time and location, purpose, driven vehicle, source, optional odometer readings, measured/entered actual distance, optional route estimate, confirmation state, associated jobs and notes. Actual mileage is nonnegative; ending odometer cannot precede starting odometer unless an explicit correction replaces erroneous data. Distance source values: odometer, manually confirmed actual, GPS-derived, route estimate. GPS-derived still requires a usable recorded track or reviewed result; denied permission or background suspension cannot produce reliable actual distance by assumption.

Incomplete/estimated legs stay visible. Arrival can close time while distance remains unresolved. No automatic doubling of outbound miles. Return and between-job legs are separate. When one leg supports several jobs, explicit attribution fractions sum to 1 for costing; the physical mileage total counts the leg once. If attribution is absent, report unattributed travel rather than duplicating miles.

Business purpose does not establish tax deductibility. Customer-car transportation, rig travel, personal movement and unclassified movement remain distinguishable. No mileage deduction rate is configured by this specification; no posting derives from mileage alone. Fuel expense and mileage must not become two automatic deductions. Any future reimbursement/deduction policy requires separate verification and accounting rules.

ETA is an approximate arrival timestamp/range with source and calculation time. It may be edited; unknown ETA uses a neutral on-the-way draft rather than a fabricated time. A changed ETA prepares an updated draft only on owner request; no repeated automatic texts. Save travel transition before invoking an external messaging/directions app.

## BR10 - Messages, review requests and follow-ups

V1 outbound communications are owner-initiated native app links or copyable drafts. States/evidence: Prepared, Opened, Owner-confirmed Sent, Failed, Skipped. Native link launch cannot establish delivered, read or sent. Record recipient snapshot, channel, template version/text, trigger, created time and confirmed-sent time/actor. Never scrape personal message history to infer delivery. Template changes do not rewrite sent content.

Completion creates one primary review request per job/customer; a multi-vehicle job is one request. Idempotency prevents duplicates on completion retries; completion/payment/return are not three separate review triggers. Warn if a customer already has a request for the same service encounter, including linked visits; an additional ask requires explicit owner decision. No arbitrary universal cooldown or 48-hour delay is introduced. Duplicate warning is required; universal day count remains configurable/unset. Missing valid contact/review URL, opt-out or owner skip records reason. A request may be manually resumed later. No reminder unless configured and deliberately activated.

Customer communication preference and opt-out apply when preparing outreach. No satisfaction filter determines who receives a review ask; the trigger is completed work, with practical skips documented. Review request status is not proof a review was submitted.

Maintenance follow-up records customer/vehicle, source job, owner-selected date/cadence, reason, status (Open, Snoozed, Completed, Dismissed) and related rebooking. No 45/90-day default, automatic price lock, membership or billing. New booking does not silently delete unrelated reminders. Recurrence, if optional V1, creates a proposed visit/task for owner review and later customer confirmation.

## BR11 - Invoices, money receipt and customer funds

### BR11.1 - Invoices

Invoice states: Draft, Issued, and Reversed (through full correcting credit/reversal). Balance status is derived: Unpaid, Partially Paid, Settled. Do not conflate Settled with received cash when a credit settled it. Display amount paid, credited and outstanding separately. Draft cancellation is allowed with audit; an issued invoice is immutable, numbered uniquely, and never deleted or renumbered. Gaps in numbers are acceptable with audit; reuse is prohibited.

Normal invoice issuance requires completed allocated scope, accepted agreement/amendment, customer/location/line snapshots, positive or explicitly complimentary total, issue date and explicit due date. Default due date equals issue date because normal collection is on completion; owner may set a later date before issue. No automatic late fee. Draft may be prepared before completion; no deposit invoice workflow in V1. Scope may be invoiced incrementally across completed visits with allocation controls. Completion creates only a draft/task; issuance is an explicit reviewed action or combined owner-confirmed finalization, not an invisible posting with unresolved tax.

Customer invoice renders flat all-in price, credit/payment history and balance. Internal tax breakdown is retained and available in accountant exports. If verified legal requirements demand different presentation, D01 must explicitly amend this rule before production; do not claim all-in display proves tax compliance.

For each receivable item, `balance_due = original_charge + valid_charge_restorations - charge_credits - net_active_payment_allocations`, evaluated from immutable events as of the report date/snapshot. For an invoice, original_charge is issued_total; opening and legacy-failure items have their own evidenced charge. All terms are cents. It must never be negative. Reducing charges below amounts already allocated requires atomically unapplying the affected payment allocation into customer funds liability, then applying the credit. Related ledger reclassifications must occur in the same transaction. Settled means zero due, not necessarily fully cash-paid. Aging uses positive balance and local due date; overdue starts the day after due date.

### BR11.2 - Receipts and splits

Payment states: Pending/Unverified, Recorded, Reversed; returned portions are linked refund events, not edits to recorded amount. Only Recorded receipts affect books or invoice settlement. Required fields: customer, received amount/time, method, destination verified business account or owner-custody channel and owner confirmation; invoice allocations, explicit tip, unapplied funds and reference/note as applicable. For cash use dedicated physical business cash or mixed-cash custody according to verified scope; checks use undeposited check custody; Dedicated business P2P balances use distinct controls. Mixed personal channels use only ACCOUNTING section 26 business-custody balances; no whole personal balance or assumed bank cash. Recording is not initiating external collection.

`received = sum(invoice allocations) + explicit_tip + unapplied_customer_funds`.

All parts are nonnegative. Invoice allocations cannot exceed open balance and must belong to the same customer/business/currency. One payment can cover several invoices; one invoice can have several payments. Split methods are separate receipt records optionally grouped as one checkout. Tips require explicit identification, count as separately tracked business revenue under the current rule and use verified tax treatment if applicable. Never infer tips from excess.

If tax configuration is pending, a receipt may be retained as unverified draft evidence; do not post tip/service classification until required mappings exist. Accidentally received advance funds without an invoice are recorded to customer funds liability once cash/account mappings are configured; this exception does not introduce a deposit product or recognize revenue before performance.

Funds resolutions: refund externally, apply to another issued invoice for the same customer with explicit approval, or reclassify as a tip only with recorded confirmation of customer intent. Never automatically forfeit excess funds or treat them as discounts. UI flags unresolved funds until resolved. Movement out of customer funds liability is posted and auditable.

### BR11.3 - Refunds versus failed payments

A refund records actual outgoing money after owner confirmation, not an instruction to a payment provider. Draft refund intent has no ledger effect. Each disbursement links funding origins and eligible descendants, reason, actual funding channel, method/reference and time. Origins are typed receipt, approved opening funds, unidentified inflow or nonposting legacy settlement. Live partitions plus net returned, net failed and terminal noncustomer resolutions equal the immutable root amount. Exact corrective restorations reopen only their original ranges. Opening funds do not require a fabricated payment row. Allocation/unapplication/tip reclassification preserve the root; per-descendant and historical capacities prevent double consumption. Unrelated damage compensation exceeding original receipts is a separately reviewed expense/liability adjustment, not an oversized refund.

- **Service concession/refund:** issue a charge credit for approved service/tax reduction. If the invoice was paid, unapply the appropriate payment portion to customer funds, then settle that liability with the external refund. Remaining valid invoice balance stays unchanged.
- **Excess-funds return:** reduce customer funds liability; no revenue reduction.
- **Tip refund:** reduce tip revenue (and applicable tax) and cash; original tip evidence remains.
- **Failed/bounced or erroneous receipt:** reverse the affected receipt/allocation and related tip/funds postings; reopen genuine receivable. This is not a concession and must not reduce earned service revenue. A partial failure identifies the affected components.
- **Charge credit without cash return:** credit remains in customer funds if already paid; never issue imaginary cash. For an unpaid invoice, credit reduces receivable.

A full receipt reversal is disallowed after partial refunds unless dependent events are explicitly unwound or a component-level reversal is calculated against remaining live amounts. An erroneous refund record with no actual outflow reverses exact original effects. A genuinely failed outgoing refund returned by the provider instead debits the actual funding channel and credits customer funds, including a failed tip refund; the original charge/tip reduction remains. Retry debits those funds, never revenue again. Incoming failure credits the actual later debit account, not an already-deposited check account; only a no-movement recording error uses the original account. Failure beyond still-live root capacity after an actual refund uses an explicitly approved 1190 exception, not invented AR or undoing a real refund. Restored incoming failures follow ACCOUNTING 24.3 original root and tax ranges. No negative amount is edited into history. Reason is mandatory for credits/refunds/reversals.

## BR12 - Accounting contract

### BR12.1 - Scope and activation

V1 operational books use explicit invoice-issued recognition: fulfilled authorized scope is invoiced to receivable; collection settles receivable. Reports say "Operational books - invoice-issued recognition; not full accrual financial statements." This is a documented product convention, not a tax election or a claim that financial statements meet a particular reporting standard. Unbilled completed work is a visible exception; V1 does not automatically estimate unbilled revenue. Reports warn about it. Cash movement is separately reported. Filing method, asset thresholds and tax obligations remain D01-D03.

Required account types: asset, liability, equity, revenue/contra-revenue, expense. Required mappings include cash/bank/payment-service assets, receivable, customer funds liability, tax payable when applicable, service revenue, separate tips revenue, discounts/returns contra-revenue, expense categories, owner contributions/draws and opening equity. Actual account names/codes and initial balances require review. Accounts referenced by postings can be archived for new use, not deleted.

Journal entries require effective date, actor/reviewer, source type/ID, narrative, posting timestamp, and lines with account, debit or credit, customer/job dimensions where applicable. Each nonzero line has one side only; sum debit equals sum credit exactly; at least two lines for a nonzero entry. Zero financial events need no fake journal. Source event uniqueness prevents duplicate postings. No posted amount/account/date is editable. Corrections reverse and replace or add an explicit adjustment with links and reason. Locked periods reject postings and corrections dated within them unless explicitly unlocked and audited.

Opening balances are a reviewed balanced entry plus reconciled outstanding receivable/customer-funds detail. Do not create an unexplained equity plug and label it verified. Every opening subledger amount must reconcile to its control account. Historical data imported as reference does not post; historical ledger migration is excluded. Only reviewed prospective openings and linked delta corrections post. Nonposting legacy settlement references permit later real concessions/failures without replaying old sales or cash. Opening receivable and legacy-failure items are collectable AR without new invoices.

### BR12.2 - Tax-inclusive calculation contract

Per-line tax profile is explicit: verified non-taxable/exempt with reason, verified inclusive single rate, or Unresolved. Production invoice issuance rejects Unresolved. V1 supports a verified single inclusive rate per line; composite/compound treatment requires explicit expanded specification before use. Store policy version, jurisdiction/classification, effective date, rate, taxable amount and tax amount. Do not infer a current legal tax rate from this document.

For an inclusive taxable amount A after discount, `net = round_half_up(A / (1 + rate), cents)` and `tax = A - net`; for verified non-taxable A, net=A and tax=0. Rate is decimal, e.g. 0.10 in a synthetic fixture only. Sum line amounts to document totals. Discounts apply to inclusive prices before extracting tax; tax changes never reprice the all-in customer total. Preserve original effective tax config; later setting changes do not rewrite history. Rounding treatment must be verified for applicable obligations in D01; if a different legally required method applies, amend this contract before activation.

Credit components use ACCOUNTING section 7's original-offset algorithm, not today's rate or rounded net remaining balance. For original inclusive cents A, net N and net discount d, offsets are 1..A; n(k)=round_half_up(N*k/A), tax(k)=k-n(k), disc(k)=round_half_up(d*k/A). A range [lo,hi] uses prefix(hi)-prefix(lo-1). Consume lowest currently available original offsets; store disjoint compact ranges and exact components. Reverse the exact original ranges, including non-last/partial reversals; partial reversal selects lowest still-consumed offsets of the selected credit. No overlap or repeated restoration. Gross return=net slice+discount slice; debit returns and tax, credit AR and discount reversal. Tip realizations share one range registry for refund/failure/reclassification. A=0 uses a unique nonmonetary correction entitlement and exact original gross/discount reversal; never divide by zero. Gross revenue before discounts uses the corresponding pre-discount net under the same profile; discount contra-revenue equals gross net minus final net so the entry reconciles exactly.

Synthetic test: $110 all-in at synthetic 10% gives $100 service/$10 tax. This fixture does not establish Indiana treatment. $10 inclusive credit proportionally allocates original net/tax; full cumulative credits must exactly consume $100/$10, not accumulate a rounding remainder.

### BR12.3 - Posting templates

These templates use no-tax test amounts unless tax is specified. Actual amounts derive from source snapshots; adjustment entries must retain dimensions/provenance. Credit terms and refund handling follow BR11.

| Event | Debit | Credit | Required check |
|---|---|---|---|
| Issue $450 earned invoice | Receivable 450 | Service revenue 450 | Completed authorized unbilled scope |
| Issue $500 gross less $50 discount | Receivable 450; Discounts 50 | Service revenue 500 | Net service revenue 450 |
| Issue inclusive $110 at synthetic 10% | Receivable 110 | Service revenue 100; Tax payable 10 | Verified profile in real use |
| Receive $475, explicit $25 tip | Asset/clearing 475 | Receivable 450; Tip revenue 25 | $450 allocated, not $475 |
| Receive $475, unspecified excess | Asset/clearing 475 | Receivable 450; Customer funds 25 | Excess visible until resolved |
| Unapply paid allocation before $100 credit | Receivable 100 | Customer funds 100 | Preserves actual cash held |
| Approve $100 service credit | Service returns 100 | Receivable 100 | Reduces charge, original invoice retained |
| Pay $100 service/excess refund | Customer funds 100 | Asset/clearing 100 | Confirm actual external refund |
| Return $25 tip | Tip revenue 25 | Asset/clearing 25 | Original tip remaining >=25 |
| Reverse failed $450 receipt | Receivable 450 | Actually debited money/custody account 450 | Revenue remains earned |
| Paid business supplies $100 | Supplies expense 100 | Funding asset 100 | Reviewed classification/receipt status |
| Owner personally pays business $100 | Expense/asset 100 | Owner contribution 100 | Explicit equity treatment |
| Owner contributes cash $500 | Bank 500 | Owner contribution 500 | Not revenue |
| Owner withdraws $100 | Owner draw 100 | Bank 100 | Not expense |
| Transfer $500 Venmo to bank | Bank 500 | Venmo asset 500 | Not revenue or expense |
| $500 transfer less $10 fee | Bank 490; Fee expense 10 | Venmo asset 500 | Reconciles gross/net movement |

For tax-bearing credits, debit original tax payable for the reversed tax portion and returns for net service; do not reverse $100 revenue on a $100 tax-inclusive refund. Discount reporting on credits reverses proportional original discounts: debit gross-net service returns and original tax; credit AR and exact original discount slices using BR12.2. No alternative net-only posting is authorized. No double-counted discount expense.

Unpaid supplier expenses may be posted only through reviewed payable-account mapping and subsequent settlement; the normal quick expense flow is paid purchases. Unresolved capitalization or mixed-use treatment stays Draft/Needs Review, or is explicitly posted to an approved suspense account with a visible exception; it must not silently inflate operating expense. Suspense is never treated as verified profit classification.

The complete required template allowlist is ACCOUNTING sections 4, 24 and 26, including unidentified incoming funds (2390), approved unresolved actual outflows (1190), typed AP/debt/owner obligations, other receivables, fixed assets/prepaids and owner custody. The short table above is a fixture summary, not a competing allowlist. Embedded fee and separate fee posting are mutually exclusive for the same economic fee. Used control-account identity/type/report role and mapping cannot be changed in V1; settlements and corrections use pinned controls. Exact source/control ancestry must be verified independently of equal totals.

### BR12.4 - Reconciliation and period control

Import bank/payment rows as nonposting statement evidence. Match to recorded receipts/refunds/expenses/transfers first. Matching does not create revenue again. Split one statement row or combine rows only with allocated amounts summing exactly to the matched statement values; unmatched remainder remains unresolved. An internal transfer must link both asset sides, not two separate income/expense records. Date/amount similarity is a suggestion, not proof.

Dedicated-account reconciliation records statement bounds and balances, immutable match revisions, outstanding timing items and as-of clearance. B = S + O exactly: book balance equals statement closing plus signed documented outstanding book movements; all real rows match once across overlapping statements. Prior-period accounting corrections are not ordinary timing items and cannot make an earlier period clean. Invalidate affected and dependent later approvals. Mixed-account custody uses section 26 business-only reconciliation, never the personal balance equation. Mark reconciled only with zero unexplained difference; owner may record an actual explained cause through its reviewed typed source and supporting subledger, not an unexplained balancing overwrite. Later changes impacting a reconciled period flag it for renewed review. Locking/unlocking is owner-only with audit. Closed-period corrections normally post in an open period with original-event references and accountant direction; never silently backdate.

Control tests: receivable ledger equals receivable-item balances (issued invoices, approved opening AR and documented legacy collection failures), by customer/item; customer funds ledger equals all unapplied balances; each cash/clearing account reconciles to its source movements; trial balance debit=credit; balance sheet assets=liabilities+posted equity+derived cumulative earnings exactly once, split into prior/current book-year display only. Trial balance sums opening journals once; no extra stored opening addition. Period locks use monthly book periods; qualified close cannot waive a control mismatch. Balanced entries alone do not prove correct classification-source-to-ledger reconciliation is mandatory.

## BR13 - Expenses, receipts and files

Expense states: Draft, Needs Review, Posted, Reversed. Required before posting: date, gross amount >0, vendor or explicit unknown-vendor reason, funding asset/liability/equity mapping, classified splits totaling outflow, business purpose, receipt(s) or missing-receipt reason, and owner review. Tax shown on a receipt is a component of gross, not added again. Recoverable/nonrecoverable purchase tax classification is configuration, not inferred. Incurred, payment and unconditional refund-claim dates are separate. Later payment uses AP settlement, earlier payment uses reviewed prepaid control; owner funding settles AP on actual payment date with no fictitious bank credit. Supplier refunds consume exact remaining cost-origin ranges at their current valid book destination with original purchase-tax provenance. Established unpaid claims use 1120; later cash settles the claim once. Depreciated/disposed/mixed-use asset or released-prepaid refunds require a reviewed component plan (D03), not a guessed expense credit.

Mixed purchase paid by business splits between business expense/asset and owner draw or approved receivable; personally paid business purchase credits explicitly chosen contribution or an evidenced due-owner obligation; spending already-tracked Crest custody instead credits that custody. ACCOUNTING section 26 governs partial personal funding, settlements, refunds and failures. Do not book personal spending as a business expense or a personal payment as business-bank cash. Shared expense job allocations sum to no more than the business cost; remainder is overhead/unallocated. No guessed equal allocation. Recurring checkbox is descriptive, not automatic monthly posting.

Receipts can be JPEG/PNG/HEIC where supported, PDF or preserved digital receipt files in an allowlisted safe format. Multiple attachments per expense; one receipt may support several explicit splits with shared evidence links and duplicate warnings. A receipt hash is a warning signal, not an absolute prohibition-one invoice image may legitimately support several reviewed components. No OCR auto-posting.

Attachments have Pending, Available, Failed, Quarantined and Archived metadata states. Available requires successful upload and checksum/size verification. Files live in private object storage; database stores metadata and durable object identity, not public URLs. Validate content type, file size and decode safety; quarantine unsafe content. Deployment must declare/test file limits and retain useful detail for damage photos/readable receipts. Preserve original receipt evidence; previews/compressed derivatives are separate and replace neither original evidence nor checksum.

Each job photo references the job and vehicle, or explicitly job-wide context, category, captured/received timestamps and optional caption. Device capture time may be untrusted; received time remains authoritative provenance. Pre-job lead/quote photos keep those links when later attached to a job. Reassigning mistaken photo links requires audit, not invisible relabeling. Customer-visible projections must exclude unrelated personal/financial attachments.

Referenced financial/accepted-quote evidence cannot be permanently deleted through ordinary UI. Archive accidental/irrelevant attachments with reason and retain required history. Retention/legal deletion requires an approved D11 policy; do not silently keep public copies or auto-purge originals to save storage. Orphan upload cleanup only removes unreferenced failed/staged objects under a documented policy, never a referenced receipt/photo.

## BR14 - Metrics and reporting definitions

Reports use posted financial records for money and explicit operational events for work. Default calendar day/week (Monday-Sunday)/month/year-to-date use business timezone, inclusive start and exclusive next-period boundary. Financial periods use effective accounting date; cash reports use receipt/refund effective date; operations use actual completion/scheduled date as labeled. Record filters, generation time, currency, basis, data cutover/completeness and report version. Never mix date bases without labeling them.

| Metric | Definition / guard |
|---|---|
| Net service revenue | Posted service revenue less discount and service return contra-revenue; excludes tax, tips and customer funds |
| Tips | Posted tip revenue net of refunds, incoming failures and classification corrections; separately visible; included in total revenue |
| Total book revenue | Net service revenue + net tips + other explicitly classified revenue |
| Cash received/refunded | Recorded incoming/outgoing cash events; report service allocations, tips, excess funds separately; internal transfers excluded from customer collections |
| Net book income | All revenue less all posted expenses for period; excludes owner draws/contributions and liability collections; warn for incomplete books/unposted work/suspense |
| Margin | Net book income / total book revenue; unavailable when denominator <=0; never imply economic profit after unrecorded owner labor |
| Receivables | Positive receivable-item balances as of date, including opening and legacy-failure items; unknown due dates in an explicit unknown bucket |
| Scheduled contracted value | Unfulfilled accepted allocation on currently confirmed future jobs, inclusive customer value; exclude cancelled/tentative scope; not recognized revenue |
| Completed jobs | Distinct completed work jobs by completion date; partial outcome shown separately; reschedule does not create another completion |
| Average ticket | Net service invoice value excluding tax/tips, attributed to completed jobs in selected completion cohort, divided by those jobs with finalized billing; show pending-billing exclusions |
| Revenue by service/area/source | Posted net service amounts allocated to immutable line/job/location/originating-lead snapshots; unallocated shown separately, never counted in multiple groups |
| Discounts | Original invoice discount net-of-tax less proportional reversals/credits; quotes alone do not count |
| New customers | First completed service date in period; distinguish CRM records created in period |
| Repeat customers | Customers completing in period who had an earlier distinct completed service encounter; linked visits fulfilling one agreement count as one encounter |
| Repeat-customer rate | Repeat customers in period / distinct customers completing an encounter in period; zero denominator = unavailable |
| Lead close rate | Won leads in lead-created cohort / all nonduplicate leads in that cohort, with still-open count and as-of date; separate period wins from cohort conversion |
| Customer lifetime revenue | Observed net service revenue + tips for customer since coverage start; show start/completeness; not predictive customer lifetime value |
| Completion rate | Completed jobs / jobs whose current confirmed scheduled end falls in selected period, as of report time; show scheduled/unresolved/cancelled counts and partial outcomes |
| Cancellation rate | Cancelled jobs / same scheduled cohort; cancelled schedule retained for attribution; reschedules reported separately |
| Active/travel duration | Sum validated intervals/legs; open/incomplete intervals excluded and counted as exceptions |
| Service revenue per active hour | Net service amount allocated to completed jobs / validated active hours for same cohort; unavailable if timing/allocation incomplete; taxes/tips excluded |
| Job contribution | Allocated net service revenue minus explicitly job-attributed business expenses and any explicitly configured travel cost estimate; label estimates and missing costs; excludes unallocated overhead/owner labor |
| Contribution per hour | Defined contribution / validated active hours for same fully qualified cohort; never label net profit/hour |
| Mileage | Physical legs once, grouped by driven vehicle/purpose; confirmed actual separate from estimated/unclassified |

Per-service/vehicle labor/profitability is unavailable when no allocation exists; job-wide totals remain valid. Jobs spanning several agreement encounters must retain explicit encounter attribution; neither multiple visits nor repeated invoice issues creates a repeat customer by itself. For the completion-rate cohort, cancelled jobs use their last confirmed scheduled end; future rescheduling moves a job to the revised cohort, and the report discloses this current-schedule basis rather than implying an immutable historical service-level measure. Paid advertising ROI and predictive CLV are future because no defensible default model exists. Full company net income is available only with complete posted books/openings for the period; otherwise title it recorded-book net income with coverage warning. A ledger that balances but lacks assets/owner transactions is not a complete balance sheet.

Required financial reports: P&L, balance sheet as of a date, trial balance, general ledger, revenue, expense, receivable aging and mileage. P&L separates services/tips/discounts/returns and expenses; balance sheet includes cumulative derived earnings exactly once, split into prior/current book-year display. Include all posted originals and reversals on their respective effective dates even if the source is currently Reversed; exclude drafts, not original history. Completion-to-billing coverage is derived from outcomes/entitlements, not draft presence; qualified reports disclose completed-but-unbilled scope/count/value, missing costs and prior-period/pre-cutover correction bridges. Financial PDF/Excel/CSV totals must reconcile at one snapshot. No default tax-return-ready certification.

## BR15 - Imports, exports and portability

### BR15.1 - Imports

Each import stores source, original file checksum, batch ID, mapping version and row IDs/fingerprints. Staging must not post or overwrite records. Preview shows creates, matches, updates, rejects, warnings and financial effects; owner explicitly approves. Imported updates respect immutable snapshots. Required formats: configurable CSV field mapping for customers, vehicles, operational history and bank/payment statements. Vendor-specific formats are not guessed; unsupported columns/encodings are reported.

Row execution is atomic with dependencies; a failed parent prevents dependent rows from committing. Batch may partly succeed only with explicit per-row results/counts and safe retry of failed rows. Stable external IDs plus source identify duplicates; otherwise normalized fingerprints suggest duplicates. A repeated file/row must not duplicate records. Identical legitimate bank transactions require owner disambiguation, not automatic deletion. No silent merging based on amount/date/contact alone.

Historical reference mode imports jobs/quotes/invoices/payment evidence without live ledger postings or current receivable effects; label them reference-only throughout reports. Financial migration in V1 is limited to D12 reviewed cutover openings and delta corrections; historical ledger replay is prohibited. On-demand nonposting legacy settlement evidence is supported for later real post-cutover adjustments. Preserve original source IDs/dates. Import rollback for draft reference data is reviewed/audited; posted financial import corrections use reversals, not deletion. Export an error report and reconciliation totals after each batch.

### BR15.2 - Exports

All implemented entities must be exportable, including addresses, customer-vehicle associations, lead conversion/source, catalog/config versions, quote families/revisions/items/approval/acceptance/amendments, jobs/scope allocations/appointments/custody, work intervals/travel, invoices/items/credits, receipts/payment allocations/refunds, expenses/splits/vendors, accounts/journal entries/lines, reconciliation, messages/follow-ups, attachment metadata and audit history. Optional assets export if implemented. No requirement to invent empty future entities.

CSV uses documented UTF-8, headers, explicit null convention, ISO dates/UTC timestamps with timezone fields, stable IDs and join keys, cents plus currency (or clearly documented exact decimal representation). Preserve all customer content while escaping formula-leading text for spreadsheet-safe exports; document a reversible escape convention in schema metadata. Do not silently alter IDs with leading zeros. XLSX stores IDs/phones as text and money/dates as proper typed values; no untrusted formulas/macros/external links. Include Read Me/data dictionary, filters/frozen headers, clearly named tabs and control totals. Split large outputs with a manifest rather than truncate at spreadsheet limits.

Provide accountant workbook tabs for trial balance/ledger/receivables/invoices/payments/expenses/mileage/reconciliation plus operational workbook data. Financial PDF reports include business identity, title/period/basis/currency, generation timestamp, completeness caveats and page totals. Customer documents and financial reports never expose internal secrets.

Every export is a consistent snapshot or explicitly bounded as-of dataset with manifest: export version/time, entity counts, filters, schema, file checksums and attachment inventory. Attachment export includes original bytes or secure retrievable batch files plus stable filename/object mapping/checksums; expiring URLs alone are insufficient. Protect export creation/download like sensitive business data and audit requester/time/scope. Full single archive ZIP packaging is future; complete data and attachment retrieval is required now. Exports are not evidence of a working backup.

## BR16 - Security, privacy, environments and change control

Private by default: customers, precise locations, photos, financial documents, backups and exports. Enforce transport encryption, encrypted managed storage, least privilege, protected secrets, input validation, safe rendering and protection against request forgery/injection. No card credentials, passwords, API tokens or production secrets in source control, logs, exports or AI prompts. Review URLs/file rendering for unsafe schemes/content. External AI processing requires explicit activation/data minimization; no automatic transfer of real customer receipts/photos to an unapproved provider. Optional public intake can only submit a rate-limited staged lead and validated attachments; it cannot read CRM data or overwrite an existing customer's fields merely by supplying that customer's email/phone. Suggested matches/updates require owner review.

Separate development, test/staging and production databases, object storage, authentication configuration, credentials and integrations. Development uses synthetic data. Restricted recovery exercises may temporarily restore real data in an isolated recovery environment with production-level access protection, disabled outbound messages/integrations and explicit cleanup; this is not a normal development environment. Do not log full customer data to troubleshoot routine errors.

Audit append-only events for creation, edits, archive, state transitions, quote approval/send/acceptance, scope allocation, financial posting/reversal, configuration changes, imports/exports, reconciliation/period locks, sensitive access administration and restore. Capture actor, time, operation ID, entity/version, reason when required and before/after or reconstructable delta. Application owner cannot edit audit or posted history through ordinary APIs; infrastructure-level privileged changes must be controlled/logged. Audit logs must remain exportable without credentials.

Every schema change uses versioned migration, tested on synthetic representative data. Destructive migrations require backup/restore verification, compatibility review and a recovery path. Release gates from PRODUCT.md apply. No test against live production simply because generated code appears plausible. No automatic archival/deletion schedule until D11 retention rules are adopted; legal retention requirements are outside this specification's asserted facts.

## BR17 - Backups and recoverability

Adopted implementation baseline: recovery point objective <=24 hours for database and committed attachment evidence; recovery time objective <=24 hours for the small V1 deployment after incident declaration. Retain at least 30 daily recovery points and 12 month-end recovery points, including recoverable referenced files and encryption/config recovery material. Architecture review D10 must verify provider capability, cost and a separate credential/failure boundary for at least one recovery copy. If this cannot be funded/supported, surface the conflict before real-data pilot; do not silently lower protection to meet $0/month.

Monitor backup success, age and recoverability prerequisites; surface failed/stale backups on dashboard and via an owner-visible alert mechanism. A database dump that references unavailable photos/receipts is an incomplete recovery. Capture enough schema, migrations, object versions/manifests and deployment configuration references to restore a compatible application. Credentials are recovered securely, not copied into portable customer exports.

Before pilot, after material schema/storage changes, and at least quarterly, restore in isolated recovery environment and verify: record counts/referential integrity; accepted revision fingerprints; receivable/customer-funds reconciliation; balanced ledger/trial balance; account openings; object checksums/readability; working restricted authentication; and application workflows. Record actual recovery point/time and discrepancies. Any lost data window is disclosed; backup completion alone is not proof of restore.

Production restore is an explicit owner-authorized maintenance operation with recent authentication, reviewed restore point, backup of current state where possible, paused writes, reconciliation and preserved incident/audit record. Never restore over an active system and silently discard later payments. Re-enter/reconcile transactions after the restore point from evidence without duplicates. Migrations after the restored version must be applied/tested before reopening use.

Production recovery additionally rotates the persisted finance recovery epoch before reopening, rejects old-epoch commands even when restored operation IDs are absent, and reconstructs later external evidence with identity aliases. Reserve known externally issued invoice numbers. If high-water is unknown, a new visible series containing the recovery-epoch UUID prevents full-number reuse; it does not resolve missing financial activity. Normal deployments and backup-age alerts do not rotate epoch. ACCOUNTING 24.9 and EXPORTS_AND_BACKUPS section 7 define the full contract.

## BR18 - Mandatory acceptance fixtures and adversarial cases

These extend PRODUCT.md P01-P19; amounts are synthetic, no-tax unless stated. Automated tests should assert persisted events, relationships and journals, not merely screen text.

| ID | Given / action | Required result |
|---|---|---|
| T01 | Lead with two vehicles → conversion retried → $525 bundle acceptance → schedule | One customer mapping; two vehicles; preserved lead; one accepted revision; allocation total $525 |
| T02 | Sent v1; v2 draft; customer accepts v1 | Acceptance valid; draft v2 cannot overwrite agreement and must become amendment |
| T03 | Sent v1; send v2; stale v1 acceptance arrives | Reject; v1 superseded; no job/financial side effect |
| T04 | Accept $450; catalog rises to $500 | Historical scope/invoice remains $450 |
| T05 | Accepted amendment races with invoice issuance | Serialize; resulting billed amounts match one coherent entitlement version; no duplicate scope |
| T06 | One $525 quote split across visits | Total invoiced entitlement never exceeds $525; a repeated completion does not rebill |
| T07 | En Route retried; Arrived retried; pause 10 of 70 elapsed minutes | One leg; one arrival; active=60 min, pause=10 min |
| T08 | Complete job while payment pending; then pay | One immediate review request; completed state independent of balance |
| T09 | Native SMS opens then is cancelled by user | Opened only; no sent/delivered assertion |
| T10 | $450 invoice; $475 explicitly includes $25 tip | Cash 475; service net 450; tip 25; receivable zero |
| T11 | Same cash but no tip confirmation | Cash 475; service 450; customer funds 25; alert visible |
| T12 | $200 then $250 payment | Balances 250 then zero; service revenue recognized once |
| T13 | Concurrent receipts exceed remaining balance | Valid cash retained; allocations capped; excess liability; no negative receivable |
| T14 | Paid $450; $100 service credit/refund | Net service 350; cash net 350; receivable zero; original documents retained |
| T15 | $450 check bounces | Receivable 450; cash reversed; service remains 450 |
| T16 | Return $25 excess | Liability zero; service unchanged; net cash 450 |
| T17 | Refund retry / attempt above remaining amount | Retry returns same event; excess request rejected atomically |
| T18 | $100 expense, two receipt images, repeated import | One expense/journal; images retrievable; duplicate warnings do not post |
| T19 | $500 service-account transfer with $10 fee | Bank +490, service asset -500, fees +10; no new revenue |
| T20 | $110 at synthetic inclusive 10%; partial then full credits | Original net/tax 100/10; cumulative credit exactly 110; no rate drift |
| T21 | Discount allocation with fractional cents | Deterministic $525 and $290.03 fixtures in BR04; all totals reconcile |
| T22 | Unknown tax profile | Quote draft allowed; production invoice issue fails explicitly, not zero tax |
| T23 | Cancel pickup job while vehicle held | Work cancelled; custody/return-required remains visible; no automatic release/refund |
| T24 | Customer drops off vehicle | Custody starts; no Crest miles/labor until actual work begins |
| T25 | 12 outbound actual +14 return actual +11 estimated | Confirmed total 26; estimated shown separately; no automatic tax expense |
| T26 | Change current customer address/vehicle owner | Existing quote/invoice/job snapshots and photo context unchanged |
| T27 | Reimport historical paid jobs with openings | No duplicate revenue/receivable; reference history and financial coverage labeled |
| T28 | Edit/post into locked period; unauthorized object request | Both rejected; no partial mutation or file disclosure |
| T29 | Loss of network after committed payment | Recover original receipt using operation ID; no second payment |
| T30 | Failed image upload then complete job | Work completion saved; evidence visibly incomplete; no false Available state |
| T31 | Export formula-like name and large numeric ID | Inert text, exact identity preserved; CSV/XLSX totals equal ledger |
| T32 | Restore DB with deliberately missing object | Recovery check fails; not declared production-ready |
| T33 | Sole operator tries overlapping timers/trips | Rejected or requires ending prior session; no double-counted labor |
| T34 | Receipt partly refunded then full reversal attempted | Reject unsafe reversal; component-aware correction required |
| T35 | Income report with missing opening accounts/timers/costs | Completeness caveats; undefined profitability unavailable, no fabricated zeros |
| T36 | Payment already allocated; full invoice credit | Unapply to customer funds plus credit atomically; no negative invoice balance; refund separate |

## BR19 - Second-pass validation and residual decisions

The adversarial pass checked temporal changes, retries, concurrent devices, partial failures, out-of-order actions, fiscal-period boundaries, duplicate data, lost evidence and misleading metrics. Corrections incorporated here include explicit allocation limits, nonterminal custody after cancellation, credit-before-refund handling with payment unapplication, immutable tax versions, clearing-account transfers, reference-only imports, incomplete-work revenue warnings, safe spreadsheet text, and attachment-aware restore.

Remaining decisions are intentionally confined to PRODUCT.md D01-D12. No approximate historic price, $50 cancellation fee, 45/90-day reminder, tax rate, depreciation election, automatic SMS provider, insurance policy or AI inference becomes a permanent rule through these documents. Required V1 remains implementable in synthetic environments; production activation must respect the specified financial/security/recovery gates. Future changes must preserve historical truth rather than recomputing old agreements from today's catalog or policies.

## Owner decisions recorded 2026-10-20

- Current requested expenditure is $0; earlier production estimates remain historical planning. Use free services only where they preserve required behavior. The budget pilot and its capacity/availability tradeoffs are specified in ARCHITECTURE section 9. Cost does not authorize permanent data loss, accounting shortcuts or weaker access controls.
- Recovery, security and backup alerts go to the privately configured owner alert mailbox. Verify ownership and actual delivery; do not send secrets/backups as email attachments. Independent monitor/provider notices must also target this mailbox. No messages or account changes were made by documenting this decision.
- Password plus authenticator TOTP; remember trusted phone/desktop sessions for up to 30 days, expiring after seven days without foreground use. Opening the app does not require a new login. Sensitive export/security/period-unlock actions can require recent authentication. Device loss, recovery or revocation can end a session earlier. Require a unique Crest password; strongly recommend a different unique mailbox password and mailbox MFA. No paid password manager required. An offline sealed recovery kit must include provider recovery material and backup decryption keys, held separately from the phone/email/app; test recovery without the phone. Mailbox-only reset must not bypass TOTP.
- Backups every six hours; 30 daily and 12 month-end points plus referenced originals. Continue financial writes after a 24-hour backup failure with persistent in-app and external email alerts; record the RPO breach. Do not destroy records to meet a storage cap. Retention is provisional preservation, not a legal retention opinion.
- Real duplicate prevention uses stable command identity and verified provider transaction IDs. Same customer/vehicle/service, even on the same day, is not unique payment identity. Flag same-customer/same-amount/same-method/same-business-date receipts for review; display candidate details and allow an explicit reason to confirm a distinct receipt. Flagging never automatically refunds, merges, deletes or rejects a legitimate transaction. Repeated service on a new job is valid; invoice entitlement controls prevent billing the same fulfilled scope twice. Deterministic rules suffice; no AI model required.
- Fresh prospective accounting start; no historical ledger import. ACCOUNTING defines the technical boundary sequence; actual local cutover and supported amounts remain activation inputs. Fresh start is not permission to assert zero cash, unpaid invoices, deposits, debts or assets. Import reviewed legacy customers and their vehicles/contact details through preview/mapping/reconciliation, with no financial posting. Preserve source batch and identifiers; no guessed field mapping or automatic merges.
- Mobile and Customer Drop-Off enabled at launch. Pickup + Return remains separately gated. Existing condition/custody/acknowledgement requirements still apply; enabling a mode does not establish insurance or legal sufficiency.
- Accountant-ready period reports and evidence: general ledger, trial balance, profit/loss, balance sheet, receivable/payable/customer-fund controls, reconciliation, invoices/receipts, mileage, asset register and corrections/export history. ACCOUNTING defines supported reports and exact reconciliation. Formal tax returns, tax advice, filing and automated depreciation are not promised; the tax preparer determines filing outputs. Prior-period records remain separately accessible for the tax preparer and are not erased by the fresh start.

This dated owner amendment controls the affected defaults and D05/D10/D11/D12 gates. All other requirements/invariants remain in force. No production gate is marked passed merely by documenting a decision.


## BR20 - Owner custody and verified activation evidence

V1 supports business-only custody in mixed personal channels and explicit prospective openings; actual channels, ownership and historical coverage remain private activation evidence. Adopt ACCOUNTING section 26's business-only owner-custody control. A receipt belongs economically to Crest's books through AR settlement/tip/funds classification, not owner-contribution revenue. Personal wealth/balances/activity are excluded. Actual transfer, personal appropriation, personal funding, fee, refund and collection failure each requires its typed event/evidence. Custody balances are not proof of a legally segregated bank asset. No automatic owner loan, sweep, distribution or personal-to-business allocation is allowed. All Indiana services/tips still require verified tax profiles; unverified collection practice and registration do not establish exemption.

## BR21 - Google Calendar is an opt-in projection of confirmed appointments

P20 is required V1 capability with optional owner connection. Only committed confirmed appointment versions publish; proposals and revised unconfirmed times never become confirmed reservations. One mapped event per job/destination survives reschedule/retry; completion retains the historical appointment and cancellation removes its active reservation without deleting Crest history, accepted scope, custody or financial records. Google changes cannot alter Crest facts or act as customer confirmation. Personal-calendar conflicts/free-busy import, recurring Google series and guests/invitations are excluded.

Default shared data is a generic title, opaque job reference, confirmed start/end/zone and sign-in-protected Crest link. Client display name, service label and work address require separately previewed opt-in; never publish money, contacts, vehicle identifiers, private notes or photos. No silent widening of payload/scope. Inherited reminders are disabled; explain Google sharing/device preview exposure. Scheduling and a typed outbox intent commit together; Google I/O follows commit. Current source version, connection generation, tenant, lease and recovery authority govern dispatch/finalization. Unknown external outcomes retain identity and require reconciliation before retry; no blind replacement ID or automatic restore replay. External changes become visible review, not silent overwrite or inbound schedule commands. See ADR35 and the researched Calendar contract.
