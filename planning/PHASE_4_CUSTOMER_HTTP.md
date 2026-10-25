# Customer HTTP boundary

This work depends on the exact reviewed customer core in PR67. It adds the HTTP consumer of that backend, not customer screens or permission to use real records. Keep the backend's migration/checksum/provenance bytes intact. Candidate/main proof must be recorded for each actual source head; the first PR67 run failed a fixture that tried to reuse a deliberately failed migration target. The corrected fixture keeps that target's pending evidence and uses a distinct positive upgrade target.

## Runtime and protocol

`NodeConfiguration.customers:true` requires explicit existing authentication and business composition. Omission/false stays closed, including encoded customer-namespace aliases; requests never fall through to settings or Next. This is trusted server composition only, with no environment activation switch or owner provisioning. Default executable remains closed. All protected routes share the same32-request process bound and committed ordinary per-session admission budget.

The five POST-only private JSON routes are `/api/business/customers/context`, `list`, `save`, `history` and `operation`. They reuse socket-derived transport, Origin/fetch-site, exact session-cookie and session CSRF checks. Requests are flat exact-key JSON bounded to8KiB, with no browser-selected tenant, actor or timestamp. Save fields include the original stable operation/customer IDs, expected version/epoch and nine draft fields. No hidden current epoch substitution or automatic retry. Input is copied/validated before asynchronous authorization. Admission commits before any SDK/domain work and is not refunded.

Context checks current crm.manage through the genuine directory read and obtains advisory writes-enabled/epoch from the existing business context. It returns a session/business-bound non-authorizing edit marker, never a credential digest or session UUID. Context calls are separate fresh reads; saves recheck the original epoch under the mutation fence, so context cannot confer authority or guarantee later eligibility. Reads retain private no-store/CSP/JSON responses and do not extend session activity.

Known save denial/not-submitted/recovery results map to fixed status/code pairs. Possible submissions, projection failure and post-commit cancellation remain Outcome Unknown. No lookup/retry/replacement ID is dispatched automatically. Historical lookup uses the original operation and remains available during paused recovery under current read authorization. Conflicts retain409 and their original reason/version.

Customer directory/history delivery has its own1MiB response cap and existing bounded buffering/deadline/disconnect cleanup. Authentication/settings retain their8KiB cap. Oversized bodies are rejected before headers rather than truncated; caller must regard failed save delivery as unknown. The private writer remains shared so successful/failed authentication exposure settlement is preserved.

## Verification and remaining product work

Unit coverage exercises protection/admission order, malformed/duplicate/encoded/authority-bearing requests, scope injection, paused context, read arguments, fixed errors and unknown save outcomes. Actual private loopback tests cover explicit opt-in, aliases, customer bodies over8KiB and rejection above1MiB while preserving the old authentication/settings bound. Existing authentication delivery cleanup tests remain required.

The genuine compiled HTTPS/Auth/PostgreSQL browser fixture enables the flag only for synthetic test runtime and exercises create/three updates, exact old replay/lookup, stale claim rollback, full source history over8KiB, literal search, paused writes and readable historical receipts on Chromium/WebKit. These native tests are pending Linux execution until this slice is published; local mocks/loopback do not prove them.

The stateless browser transport validates exact source/receipt/history/business/version bindings and private response headers, rejects duplicate keys at any nesting level, bounds streamed UTF-8 responses to1MiB and stops stalled reads on cancellation. It copies the original save/reference before awaiting fetch, preserves exact bigint strings, maps only fixed matching error/status pairs and never performs automatic lookup/retry/replacement. It stores no credentials, proofs, customer cache or pending payload. Targeted tests cover these boundaries; no screen is wired yet.

Customer forms/controller, per-tab pending-save handling and common-format private download remain next. Respect ADR22: no customer-data offline cache, background replay or silently dropped unknown intent. Design the pending-reference/reload behavior explicitly before storing any contact data in browser storage. Default-closed runtime, complete export/recovery, phone/provider and real-data gates remain.
