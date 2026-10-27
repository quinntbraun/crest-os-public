# Phase 5: service definition and version editor

2026-10-27. Small commercial-domain continuation of PHASE_5_QUOTE_WORKSHEET.md under BR03/P04/P05. Shared application code implements owner-entered service definitions and immutable in-memory scope versions. The local /quotes worksheet exposes this for fictional review. Genuine catalog storage remains incomplete; no production service endpoint is enabled.

## Implemented behavior

src/commercial/service-catalog.ts validates and copies complete service definitions: name, included work, exclusions, optional internal guidance, optional starting range and optional duration. Money remains nonnegative exact bigint cents, with no upper guidance below its lower guidance. An upper estimate requires a lower estimate. No historical prices, service templates, category surcharges or current Crest service descriptions are installed.

Stable UUID/code identify a service. Content edits append a contiguous immutable version; active/archive changes advance the separate optimistic revision without creating another scope version. Unchanged submissions do not manufacture versions. Archive retains every scope version, blocks new quote copies and permits explicit reopen. Stale edits, activation and copies fail. Inputs are copied and all nested outputs frozen, so caller mutation cannot alter earlier versions.

Copying an active service produces a frozen customer-facing snapshot: stable service ID/code/version, name, included work and exclusions. Internal guidance, starting range and estimated duration are not copied into customer scope or used to invent an offer amount. Existing quote-line descriptions, exclusions and manually entered amounts remain independent of subsequent service edits/archive/reopen. The owner can adapt copied scope explicitly in the line editor.

src/app/quotes/service-editor.tsx starts empty, supports owner definitions, optional guidance and minutes/seconds, retained versions, archive/reopen, duplicate-code refusal and direct copy into a quote. Seconds are preserved exactly on reopen rather than rounded away. The quote worksheet displays each source version and requires the owner to enter its all-in amount. Existing exact discount calculation and zero-work/Extreme safeguards remain.

Technical input limits are200 code points for names,4000 for scope/exclusions/guidance,80 lowercase ASCII code characters and1000 retained content versions per review service. These are processing bounds, not business prices or proposed live catalog limits. Service codes are immutable in this editor. Copying is refused when the existing100-line worksheet capacity is reached.

## Explicit persistence boundary

The editor's library and worksheet live only in page memory. Leaving/refreshing clears them; partial service input also triggers the existing navigation warning. The library is excluded from the sample download, clearly labeled unsaved and has no localStorage/file/JSON/SQLite business persistence. It is not a second catalog backend, an audit ledger or a substitute for genuine PostgreSQL/Auth.

No service SQL table, registered migration, trusted mutation, authenticated route, server-derived audit, export coverage or recoverable catalog backup is claimed. Actual issued quotes and customer/vehicle parent bindings are still absent. There is no approval/send/acceptance or financial posting action. The model is reusable input/business logic; it grants no authentication or database authority and does not prove arbitrary externally supplied history.

The local supported genuine runtime still awaits the owner's WSL/Docker setup described in FREE_LOCAL_TEST_SETUP.md. This turn completes independent domain/UI work; it does not interpret queued continuation messages as installation consent or completed setup. No software install, provider signup, host security change or paid service occurred.

## Executed verification

40 new service unit cases plus the35 existing pricing cases pass. Checks cover immutable scope/version identity, customer-only copies, old-price/scope independence, archive/reopen, stale revisions, no-op submissions, caller-owned mutable input, malformed text/shapes, guidance ordering, exact bigint money, duration/second preservation, sequential versions and overflow.

All28 real HTTP preview cases pass, including a new boundary case confirming service save/archive/reopen remain unavailable and leave sample records/history unchanged. The live review JavaScript hash and all saved fictional CRM rows/history remain identical across the isolated HTTP test builds. Types and focused lint pass; canonical verification, migration registry and public boundary are checked separately at the checkpoint. No full current-source native/build/release acceptance is claimed.

Actual browser verification created a fictional service, refused an inverted range and duplicate code, copied version1 with a blank amount, entered$125, changed scope/guidance and archived it, confirmed the earlier quote stayed at$125 with its original scope, reopened and copied version2, then entered$200 for a$325 total. The quoted preview excludes the internal note. Editing preserves90minutes30seconds. Earlier scope versions remain visible. At360px the document is345px wide with no horizontal overflow; viewport restored. The prior fictional worksheet tab was preserved when its navigation warning prevented a refresh; the new deliverable is tab3. Both are explicitly synthetic drafts.

## Next concrete work

Construct the genuine catalog migration/command and native acceptance cases using existing owner/session/operation/audit/recovery fences, then add catalog source exports and restore coverage before calling services saved. Preserve registered43 and resolve the separate unregistered export-admission proposal's recorded default-ACL failure before using that proposal; do not accidentally adopt it or renumber history. Document capability/schema/adoption decisions explicitly. After native acceptance, wire the editor to that trusted storage and implement persisted quote revisions with exact-revision approval and immutable sent/accepted representations.

No further preview-only persistence layer is needed. No scope reduction, framework replacement, dependency or CI policy change is made. V1 coding remains roughly25-35%; durable synthetic CRM still has a low-confidence15-30 active-hour estimate after runtime prerequisites, and full V1 has200-350 active hours remaining. Real Crest use remains gated. Cost$0.
