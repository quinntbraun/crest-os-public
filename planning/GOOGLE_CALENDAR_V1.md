# Google Calendar V1 investigation and implementation contract

2026-10-22. Owner-requested scope addition; researched against official sources below. This is a design contract, not implemented calendar software or evidence of live Google testing. PR29/main66fde5714264c7412c2b1fa199aef74cdc37a562 passed full main CI39871551267 before this amendment. No runtime, dependency, schema, authentication-provider or financial change; app0.1.0/schema0..16/report0/command1 and production blocked. Additional paid services:none.

## Decision and scope

P20 requires V1 to support an owner-controlled Google Calendar connection. Connecting is optional for the owner; implementing and testing the capability is required V1 work. Enable automatic outbound publication only after explicit connection and payload preview. Crest OS remains the authoritative schedule, including accepted scope, client confirmation, conflicts, travel, custody and billing. Google is a derived convenience view; it never authorizes access or changes a job. The disconnected/manual internal calendar remains fully usable.

Use the owner's Google authorization to create a dedicated secondary calendar named Crest Jobs. It appears alongside other calendars in Google; primary-calendar writes are outside V1. Start with calendar.app.created, which limits calendar access to app-created calendars; do not request all-calendar, calendar-list, ACL, Gmail, contacts, Drive or free/busy access to make setup convenient. If account identification requires OIDC, separately disclose minimal openid/email scopes and verify issuer/audience/nonce/subject with a maintained library; email is display metadata, not Crest authorization. Final scope support and returned account/calendar identity require actual consent/API tests. No service-account ownership or domain-wide delegation. [S02][S03][S04][S16]

Connection setup previews the Google destination and the exact shared fields. Default events contain a generic Crest job label, opaque job reference, confirmed start/end and timezone, and a Crest URL that still requires sign-in. No financial data, phone/email, internal notes, photos, vehicle identifiers or customer name/address by default. Owner-selected client display name/service label/work address are separately previewed opt-ins, versioned and auditable; no silent future field expansion. This makes the calendar useful while allowing minimal-data use. Private event visibility is defense in depth, not proof of private calendar sharing or notification previews. Setup must show the owner how to check Google sharing and device notifications; the narrow scope does not prove ACL state. No guests, invitations, conference creation, calendar sharing or automatic customer messages. Explicitly disable inherited reminders for published events in V1 to avoid unsolicited notifications. Google/account device policies can still affect display. [S02][S04][S05]

Only confirmed scheduled appointments are eligible. Proposed holds, draft/revised unconfirmed times and cancelled jobs are not new confirmed reservations. Each linked job has its own event. Confirmed rescheduling updates the mapped event; cancelling removes its active Google reservation but preserves all Crest source/history/money/custody. Completed jobs keep their historical appointment; completing work is not a new booking. Time conversion uses stored UTC instants, original IANA zone and reviewed offset; reject nonexistent local times and require disambiguation of repeated times. No inferred end time or silent daylight-saving shift.

## Free options examined

| Option | Assessment |
|---|---|
| Direct Google Calendar API from Crest's existing server/worker | Selected. Automatic create/update/cancel, narrow consent, explicit status and own transaction/outbox/recovery logic; no paid sync intermediary. Standard API use currently has no additional charge, subject to quotas and announced billing changes. |
| Download/import ICS or CSV | Useful portable/manual fallback later; Google explicitly says imported events do not stay in sync. Repeated imports cannot satisfy automatic reschedule/cancel or duplicate-prevention requirements. Not a substitute for P20. [S10] |
| Calendar subscription feed | Not selected. Requires a Google-fetchable feed/secret URL and loses direct acknowledgement/control of refresh timing. A bearer feed is a new private-data access path. No public calendar/feed or promised refresh interval will be introduced. |
| Google Apps Script bridge | Possible free building block, but adds another deployment, credentials, triggers and quota/failure state outside Crest's tested worker. Script execution has a six-minute limit and daily quotas. Direct API integration is simpler for this monolith. [S11] |
| Paid automation platform | Unnecessary for the selected design; no subscription approved. |
| Self-hosted calendar/CalDAV replacement | Could provide another calendar, but does not remove Google consent/API requirements to populate the owner's Google account. Building a calendar server adds maintenance without meeting the integration by itself. |

Google's current new-project defaults are 600 requests/minute/user/project and 10,000/minute/project, with a 1,000,000/day/project billing threshold. The guide announces later-2026 billing changes and advance notice; these are provider facts checked today, not permanent price guarantees. Do not depend on reaching those limits: use a dedicated project, a durable shared local budget of at most 60 Calendar requests/minute and 5,000/day/project, counting retries/reconciliation/failed calls, and a circuit breaker. These conservative engineering ceilings are not measured capacity claims. They govern Crest's calls, not unknown external use of the project; verify project-level limits as well. Recheck actual project quotas/pricing and billing-disabled behavior before setup; no billing account, overage, paid quota increase or automatic upgrade. If zero-charge operation cannot be verified, leave integration disabled and report the owner gate. Calendar may pause visibly at a local budget without blocking internal scheduling. Worker hosting/uptime is part of the still-unproven free production operating plan. [S01]

## OAuth and connection lifecycle

Use a maintained server OAuth library and Google's supported authorization-code flow. Start from a freshly authorized Crest owner action with Origin/CSRF checks. Use one-use expiring state bound to initiating actor/business/app session, expected Google issuer/client, exact allowlisted callback and connection attempt; reject replay, changed sign-in, account mix-up, denied or incomplete scopes. Apply PKCE with S256 where supported by the selected Google web-client flow/library and verify that support in real tests; do not invent protocol support. RFC9700 informs the security review. No implicit flow or pasted password/token. Callback is a separately reviewed narrow OAuth exception to ordinary Origin/CSRF handling, not a generic CSRF bypass. Codes/state/query strings must not leak to logs, referrers, analytics or rendered errors. The callback has no third-party resources and returns to a clean same-origin URL. [S03][S12][S15]

Refresh/access tokens remain encrypted server-side under a distinct integration purpose/key context, inaccessible to browser, ordinary exports, CI and public source. Serialize refresh; preserve an existing refresh token when Google's successful response omits a replacement. Classify uncertain token rotation/storage separately, retaining safe recovery state rather than logging token material. Fresh Google access is not a Crest login, grant or recovery bypass. Persist subject/destination/generation/consent version/scope metadata and redacted failures. Disconnect first fences new work locally, drains bounded in-flight work and revokes access through the reviewed Google grant path; uncertain revocation remains visible. It does not erase existing Google events or all Crest jobs. Cleanup of known mirrored events requires a separate preview/explicit action while authority still exists; no whole-calendar deletion or bulk delete of unrelated events. Explain that revocation can affect other tokens in the same Google grant. [S03][S12][S16]

External Testing refresh tokens normally expire after seven days for Calendar scopes. Personal-use verification exceptions may apply for a sole known user; this is not the same as the Workspace-only Internal audience or a promise of verification exemption. Before activation verify the actual client audience, publishing mode, scopes, warnings, owner account policy and applicable Google review requirements. No paid Workspace subscription is assumed. Later employees/distribution require renewed scope/security/review assessment. [S08][S09]

Creating a secondary calendar has no client-selected calendar ID in the documented request. If creation times out after Google may have committed, preserve the attempt and stop; never blindly create another calendar. Recovery must prove the original app-created target with the same account/project and explicitly recorded destination before enabling events. If the narrow scope cannot discover an unknown target, owner review in Google is an activation gate; do not add broad scope or adopt a calendar by its title. Reconnection must not silently provision a second calendar or target a different Google account. [S04]

## Durable dispatch, concurrency and uncertain outcomes

Scheduling commits the authoritative appointment/history and typed outbox intent in one PostgreSQL transaction. Google network calls happen later, outside that transaction; provider outages cannot roll back a valid appointment. A named narrowly privileged worker owns only this projection, with bounded claims, attempts, timeouts and payloads. Retain business/job/appointment version, destination and connection generation, original recovery epoch, lease fence and a stable opaque event ID chosen once per mapped job/destination. Use a UUID-compatible lowercase hex encoding within Google's ID rules, not customer data or an epoch/version-derived replacement ID. Mappings and successful/uncertain attempt history are retained. [S05]

Per-job/destination serialization and source-version checks prevent older jobs overwriting newer schedule state. Coalesce only work proven not dispatched; never discard an unresolved in-flight external attempt as superseded. After timeout/lost acknowledgement, query the original mapped ID and verify owner-controlled correlation plus expected projection before retrying an identical operation;409 is not proof our insert succeeded. A mismatching ID is a collision/conflict requiring review, not permission to overwrite. Avoid claiming globally exactly-once delivery: Google documents distributed ID-collision limitations, and PostgreSQL cannot atomically commit Google side effects. [S05][S06]

Use provider etags/conditional mutations to prevent lost external edits. If-Match412, a moved/deleted event, revoked access, wrong destination/marker or differing managed content becomes Review needed. Unexpected externally added guests also stop mutation for review; do not rely only on sendUpdates=none to prevent mail side effects. Never treat Google changes as confirmed Crest rescheduling/cancellation, and never silently overwrite/recreate a manually deleted event. Explicit repair previews the latest committed Crest appointment and remote state. Network uncertainty about our own cancellation is resolved against the original known event and retained attempt; provider404 alone does not prove an active appointment was intentionally cancelled. No primary-calendar adoption, title matching or deleting unmapped events. [S06][S07][S17]

Retry only classified transient failures, with bounded exponential backoff/jitter, shared budgets and attempt limits;429/quota403 differ from permission403, invalid_grant and malformed requests.401 may permit one serialized refresh, not an infinite reconnect loop. All terminal/conflict/authentication failures stop automatically and surface actionable state. Sync now requests bounded deduplicated server work; double clicks/two devices do not create extra events. UI shows Disconnected, Pending, In progress, Synced to appointment version, Delayed, Reconnect required or Review needed, with last confirmed time. Never show current Synced from an older acknowledgement. Healthy dispatch targets <=5 minutes, to be measured in staging; no real-time or guaranteed Google/mobile-client refresh promise. [S01][S07]

Use outbound outbox changes plus bounded periodic reconciliation of only the dedicated calendar. No all-calendar/minute polling, mandatory webhooks or Redis. If incremental provider reads are introduced, finish all pages before advancing the sync token;410 resets only the derived Google cache, never Crest jobs/history. Optional future push notifications are hints: they can be lost and their channels expire; they cannot replace reconciliation or authorize mutations. [S13][S14]

## Recovery, portability and activation

Every claim, before-dispatch decision and local finalization checks current connection generation, recovery authority and lease. An epoch change never self-upgrades old work. External requests already sent may still commit after local cancellation; before restore/disconnect completion, fence old worker credentials and drain bounded in-flight requests, preserving unresolved external effects for reconciliation. Restoring the database leaves Google unchanged. Freeze dispatch until reviewed comparison of retained mappings/evidence against actual dedicated-calendar events handles remote-only, missing, changed and uncertain items. Do not replay restored queues or mass-recreate calendars/events. Reconstructed mappings retain original event identity and provenance; lost evidence is a review gate, not a duplicate-creation shortcut.

Export connection metadata excluding secrets, selected fields/consent history, destination/event mappings, source versions, last confirmed state and redacted attempts in open schema/CSV with useful XLSX presentation. Credentials are excluded from customer exports; encrypted secret recovery uses separately restricted backup/key procedures, or deliberate reauthorization. Complete backups retain these logical records. Google copies/ICS are not backups or the authority for reconstructing customer/financial truth. Disconnection/recovery must not erase audit/history or modify ledger/source facts.

Implementation order: finish Phase 2 orphan reconciliation/maintenance and Phase 3 files/recovery, then CRM/catalog and Phase 6 authoritative scheduling/outbox. Build P20 as small migrations/server protocol/worker/UI slices alongside scheduling, with full release gates. This document adds no speculative generic integration framework. The mainline foundation remains default-closed while being built.

## Required acceptance evidence (planned, none passed yet)

| ID | Proof required before P20 is complete |
|---|---|
| GC01 | Actual Google owner consent with least scopes, intended account/dedicated calendar, exact preview; denied/partial consent, changed sign-in, state replay, callback/account mix-up all fail closed; no broader permissions. |
| GC02 | No token/code/state leakage in URL cleanup, logs, browser storage, exports, error output or screenshots; encryption/key loss/rotation and separate integration authority verified. |
| GC03 | Actual synthetic create, confirmed reschedule, cancellation and completion/history in Google; two linked jobs map separately; no proposed-slot export, guest email or inherited reminders. |
| GC04 | Timezone/DST gap/fold, midnight/date rollover, alternate zones, UTC instants and repeated local times match app/Google desktop and real phone. |
| GC05 | PostgreSQL appointment/outbox atomic commit/rollback; permission/RLS, cross-business/guessed connection/event denial; no Google I/O before commit. |
| GC06 | Duplicate click/worker, expired lease, reversed version order, simultaneous reschedule/cancel and update while in flight converge to current source without duplicate events. |
| GC07 | Real provider commit followed by response loss and worker death; original-ID reconciliation and409 collision mismatch; no blind new ID or false success. |
| GC08 | Uncertain calendar creation/reconnect/account change does not create/adopt an unproven duplicate calendar or broaden scopes. |
| GC09 | External edit/delete/move/guest addition, etag412 and unrelated events are preserved/flagged; explicit repair cannot reschedule Crest, erase history, send guest mail or change financial/custody state. |
| GC10 |401/expired token/omitted refresh token/revoked grant/invalid_grant, refresh races and uncertain persistence: safe reconnect state, no token reuse storms or lost safe credentials. |
| GC11 |429/quota403/permission403/5xx/timeouts/malformed responses, retry budget and shared daily/minute ceilings; internal scheduling works while Google fails. |
| GC12 | Disconnect/drain/revoke including uncertain remote completion; queued work fenced, existing events explained, separately approved mapped-only cleanup. |
| GC13 | Restore stale queue/epoch/generation, former-worker fencing, lost mapping and remote-only events; no automatic requeue, mass replay or duplicates. |
| GC14 | Reconciliation pagination/checkpoints, missing/changed events, invalid sync token and optional dropped notifications; cache reset never deletes source jobs. |
| GC15 | Consent-field changes, unsafe text/Unicode/URLs, minimal payload/no PII by default, Google sharing/device preview warning, no email/invitation side effect. |
| GC16 | CSV/XLSX secret-free roundtrip plus isolated encrypted backup/restore or reauthorization; exact mappings/history retained. |
| GC17 |360px/desktop keyboard/a11y, focus/reload/offline/late response/double click, clear old-version versus current sync state; real Google/phone visibility and measured <=5-minute healthy dispatch. |
| GC18 | Actual project free quotas/pricing/billing-disabled behavior, consent publishing mode and personal-use/review eligibility; recovery/access drill and existing whole-app M/D/N/R gates. |

Deterministic tests use synthetic server fixtures/fault injection plus actual PostgreSQL grants/transactions. Real Google staging with synthetic appointments is a distinct required gate and cannot be replaced by mocks or the chat's Google Calendar connector. That connector's authorization does not create app OAuth credentials. There is no claim that any software can be proven bug-free; completion means the specified evidence ran successfully, known defects were resolved and residual limits are disclosed. No calendar test is passing merely because it appears in this matrix.

## Source register (checked 2026-10-22)

- S01: [Calendar usage quotas, free threshold and announced billing changes](https://developers.google.com/workspace/calendar/api/guides/quota).
- S02: [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth).
- S03: [Web-server OAuth, offline access, callback and token lifecycle](https://developers.google.com/identity/protocols/oauth2/web-server).
- S04: [Secondary-calendar creation and intended user ownership](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert).
- S05: [Event insert, ID rules, timestamps, reminders and visibility](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
- S06: [Etags and conditional modifications](https://developers.google.com/workspace/calendar/api/guides/version-resources).
- S07: [Error classification and retry guidance](https://developers.google.com/workspace/calendar/api/guides/errors).
- S08: [OAuth refresh-token expiration, including External Testing](https://developers.google.com/identity/protocols/oauth2).
- S09: [Personal-use verification exceptions and audience distinctions](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).
- S10: [Manual imports do not stay synchronized](https://support.google.com/calendar/answer/37118?hl=en).
- S11: [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).
- S12: [OAuth credential/token/state best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices).
- S13: [Incremental sync, pagination and expired-token cache reset](https://developers.google.com/workspace/calendar/api/guides/sync).
- S14: [Push notifications, expiration and reliability limits](https://developers.google.com/workspace/calendar/api/guides/push).
- S15: [RFC9700 OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html).
- S16: [Google OAuth policies and minimum necessary scope](https://developers.google.com/identity/protocols/oauth2/policies).
- S17: [Event deletion, authorization and notification caveats](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete).

Provider facts must be rechecked before account setup/activation. Source links support provider facts; state-machine/outbox/privacy/budget decisions above are Crest engineering choices. No new account, login, billing, live event, deployment or credential extraction was performed. Owner Google project/consent is needed later for actual-provider gates, not for this research or unrelated foundation implementation.

[S01]: https://developers.google.com/workspace/calendar/api/guides/quota
[S02]: https://developers.google.com/workspace/calendar/api/auth
[S03]: https://developers.google.com/identity/protocols/oauth2/web-server
[S04]: https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert
[S05]: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
[S06]: https://developers.google.com/workspace/calendar/api/guides/version-resources
[S07]: https://developers.google.com/workspace/calendar/api/guides/errors
[S08]: https://developers.google.com/identity/protocols/oauth2
[S09]: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
[S10]: https://support.google.com/calendar/answer/37118?hl=en
[S11]: https://developers.google.com/apps-script/guides/services/quotas
[S12]: https://developers.google.com/identity/protocols/oauth2/resources/best-practices
[S13]: https://developers.google.com/workspace/calendar/api/guides/sync
[S14]: https://developers.google.com/workspace/calendar/api/guides/push
[S15]: https://www.rfc-editor.org/rfc/rfc9700.html
[S16]: https://developers.google.com/identity/protocols/oauth2/policies
[S17]: https://developers.google.com/workspace/calendar/api/v3/reference/events/delete
