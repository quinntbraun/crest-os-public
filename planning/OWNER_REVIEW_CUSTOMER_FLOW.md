# Shorter everyday customer flow

2026-10-27. Continue the owner's request for a visible, usable, simpler app. No business-rule, database, authentication, accounting or production-activation change.

The customer editor now puts name, phone and email first. Email is immediately available without a Record email checkbox, uses an email keyboard/autocomplete hint, and maps blank input to unknown/null. It keeps the existing text source contract: storing an email does not validate a mailbox, authorize contact or send a message. Unusual original email text remains representable; no new HTML email-pattern restriction is imposed.

Notes, contact preference, customer-since and archive controls move into Notes and more customer details. Existing recorded empty values, outreach flags, archival reason requirements, source versions and history remain unchanged. An outreach opt-out notice stays visible outside the collapsed section. Contact summaries in the private directory show existing phone/email values with presentation-only phone formatting; accessible record-button names remain stable. Client-only initial rendering, current authorization, page suspension and pending-save controls remain intact.

The native customer browser fixture now opens the extra-details section before exercising those fields and checks the direct empty email input. Its existing raw/null/empty, outreach, archive/reopen, stale-version, audit and original-save checks remain. Actual native/browser release acceptance is still separate from local review evidence.

## Preview updates without restarting sample storage

`npm run review:build` rebuilds the shared UI and publishes a complete asset snapshot through an atomic file rename. The existing review server reads that snapshot for its whitelisted JavaScript/CSS requests, retains the last working asset set if a rebuild is incomplete, and preserves the current sample data and review-session binding. There is no automatic page reload: finish an unsaved draft before refreshing. Backend changes still require controlled restart and explicit sample row/history preservation; this does not establish continuous durable storage or a production backup.

## Executed checks

Full local units5964/183files passed. The focused customer/phone/email group has36 cases; types and focused lint pass. Eight real-HTTP review cases cover the previous workflows plus a running server serving a new full UI build, retaining an explicitly saved sample customer and refusing incomplete asset data without replacing its working bundle. Browser review verified direct email creation, collapsed notes and visible outreach opt-out, save/reopen with exact notes retained. Current-session phone, address and map-suggestion behavior remains available; no external provider, dependency or schema change was added.

Next continue visible workflow feedback and the supported database-backed sample installation. Preserve saved fictional work and inspect for unsaved drafts before updating the owner's tab. Full V1 percentage/hour estimates remain withdrawn until the remaining workflow inventory can support them. This is still sample-data review; real customer and financial use remains gated. No spending or signup is required.
