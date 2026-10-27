# Phase 5: exact quote pricing and unsaved worksheet

2026-10-27. First executed commercial slice under PRODUCT P04/P05 and BR03/BR04. Working review10 exposes /quotes in the local review. The pricing module and React worksheet are shared application source, not a second backend or a catalog populated from historical prices.

## Scope and decisions

src/commercial/quote-pricing.ts implements the BR04 quantity-one all-in line calculation. Gross inputs are the owner's nonnegative inclusive amounts after any owner adjustments or embedded travel. Dollar/percentage input parsing and storage-facing cents/rate strings use BigInt throughout. Percent rates have up to eight fractional digits (UI percentage entry up to six), with explicit round-half-up at line and document discount boundaries.

One line discount and one document discount are supported. The document base includes only explicitly eligible remaining amounts after line discounts. Largest-remainder allocation uses exact integer cents and stable supplied line order for ties; excluded and zero-weight lines receive no share. Inputs/outputs reconcile, no allocation exceeds its remaining line value, and line/document totals must fit the existing bigint storage range. This range is a technical storage bound, not a suggested price/minimum/maximum.

Zero-value final lines require meaningful complimentary-work reasons. Complete zero offers consequently have reasons for their lines; no payment, invoice or journal event is fabricated. Unsupported shapes, precision, rates, discounts, duplicate IDs and overflow fail rather than clamp, truncate or silently stack.

The shared worksheet lets the owner enter included work, exclusions, draft category/condition and amounts. The five initial categories and four initial conditions come directly from BR03 and contain no prices or surcharges. Extreme condition shows the required future approval-review notice; it does not automatically change an amount or authorize work. The explicit fictional example uses the canonical $250/$300 minus $25 arithmetic fixture and includes applicable leather care/excludes exterior protection. No historical example is installed as a live service catalog default.

This is a local, unsaved price/scope worksheet, not a persisted quote entity with genuine customer/vehicle FKs. Stable UUIDs identify draft calculation lines only. There is no production Next quote route or quote API, no saved catalog or offered revision, no approval/hash/send/acceptance action, and no tax posting. /quotes is whitelisted only in the loopback review router. Drafts may display a not-yet-configured tax treatment; they cannot issue an invoice or add a surprise checkout tax.

Worksheet entries stay in page memory, warn before leaving and are excluded from the sample data download. They do not use localStorage, fake authentication, a JSON/SQLite business database or a new provider. The worksheet reads no protected entity/session source; it operates on explicitly entered draft values. Existing protected CRM suspension behavior is unchanged. Review UI capacity is100 lines and the pure calculator rejects requests above1000 lines as a processing bound; nothing is silently dropped.

## Executed verification

35 pricing unit cases pass, including the two canonical allocation fixtures, sequential discounts ($100 less10% then10% gives$81), round-half-up, eligibility, free-work reasons, fractional percent limits, amounts beyond Number safety, SQL bigint range and malformed shapes. One case exercises576 deterministic varied allocation scenarios and checks conservation, bounds, input immutability and repeatability; these are scenarios inside one case, not576 separately counted tests.

All27 real HTTP preview cases pass. The new case confirms the worksheet route while quote save/approve/send/accept remain unavailable and no quotes table appears in sample storage. An actual running-preview check confirms its JavaScript hash, saved CRM records and retained histories are unchanged across those isolated test builds. Types and focused lint pass. Full native/build/release acceptance for this local source remains unclaimed.

Browser review loaded the fictional two-vehicle example and verified$525 total with$11.36/$13.64 shares; changed it to sequential10% discounts and an excluded line ($81 plus$300); refused an excessive fixed discount; required a free-work reason for a zero line; and showed the Extreme notice without a surcharge. The canonical example was restored. Mobile360px document width is345px, viewport restored. The review shortcut scrolls directly to the readable draft preview; screenshot saved. Existing saved fictional CRM data was preserved before the controlled route restart and after checks.

No database schema, registered migration, dependency, CI policy, provider, production activation, real data or paid service changed. Registry43 remains the data baseline; the separate unregistered export-admission proposal is not adopted here.

## Next coherent step

Implement the versioned owner-edited service catalog with genuine storage/audit/export/recovery, then persisted quote drafts and immutable owner-approved/sent/accepted revisions. Recheck this pure calculation on the trusted server/database boundary rather than trusting browser totals. Service inclusion rules, exact revision approval, duplicate scope review, travel treatment and tax interfaces must be enforced before actual offers. Do not turn the worksheet into an implicit issue/send shortcut.

The V1 estimate remains roughly25-35% coding complete; this begins the commercial group but does not complete catalog/quotes. The broad15-30 active-hour durable synthetic-CRM and200-350 full-V1 ranges remain low-confidence planning estimates from V1_DELIVERY_INVENTORY.md, not new per-turn promises. Windows WSL/Docker setup is still needed for the local genuine stack; independent source work can continue. Cost remains$0 and real-data use remains gated.
