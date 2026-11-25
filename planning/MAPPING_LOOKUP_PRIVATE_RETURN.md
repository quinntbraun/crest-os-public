# Safe mapping lookup return

The original S13 context requirement applies to safe read filters as well as cross-route breadcrumbs. Mapping navigation already whitelisted a static purpose/category and a lookup date, but pagehide or a restored page cleared those controls while leaving their URL intact. Category attention filtering was also lost on reload.

Lookup privacy clearing now retains only that static enum, validated lookup date and finite category attention flag. Loaded account/mapping/directory/history data, private query text and stale result/focus references are removed. Actual access denial reuses the same complete private-clear function and focuses the sign-in notice. No history, mapping or directory is automatically read on return.

The category-only `attention=only` flag passes through validated lookup, management breadcrumb and sign-in return links. The actual category page supplies its validated initial value. Fixed mappings discard it; arrays, unknown flags and unrelated values are excluded. The filter affects only which checked category rows are displayed and supplies no posting authority.

Approval-editor purpose/drafts/effective dates, pending originals, save/retry/lookup/retirement commands, version conflicts, SQL, grants and financial rules are unchanged. In particular a lookup date still never fills an approval's effective date. No schema migration or activation is introduced.

The older lookup tests explicitly expected public purpose/date controls to become empty on pagehide. Those UI expectations are intentionally revised to require the safe retained controls and contextual link, while strengthening absence checks for actual account results and history. Invalid/duplicate query rejection and every original financial, immutable-version, recovery, CSV and conserved-source assertion remain required. The management-editor empty-field/privacy expectations are retained.

The configured original mapping/category browser journeys add pagehide/persisted-page return layouts, no automatic business requests, category attention privacy clearing/reload/explicit checked-directory reload, and source conservation. Explicit read requests continue to use real authentication and actual registered readers; transport failure tests do not fabricate financial results. Extra category reads wait for existing session-admission capacity if necessary without resetting sessions, changing policy, retrying requests or increasing parent deadlines.

The 62 focused navigation/server-page/sign-in checks pass. Rendered/full-journey and release evidence must be recorded against the tested source before acceptance. S06/S13 and the complete audit are not signed off by registered tests alone.

## Executed evidence

On local `a3f3c64`, the complete fixed-mapping journeys pass **2/2** in `.local/design-mapping-private-return-fixed`, and the complete category-approval journeys separately pass **2/2** in `.local/design-mapping-private-return-category`. Both include Chromium and WebKit. Each run retained a fixed tracked source and cleaned its own temporary database. Original approval versions, committed/absent-original recovery, CSV/recording evidence, actual new-sign-in return and financial-source conservation assertions pass. Only the documented public lookup-control clearing expectations changed; approval-editor empty-field/privacy expectations remain.

The native cases additionally prove actual loaded-history/private-result clearing with safe purpose/date retention; category attention survives private clearing and a real page reload, performs no automatic private read and applies after an explicit genuine directory read. Custom search text and loaded account codes are absent after clearing. The shared return helper inspects the persisted-page path at 360/390/430/1440px with accessibility/overflow checks and no business requests. Sixteen additional private-return views are retained in `.local/design-mapping-private-return-captures/captures.json`, together with the existing configured journey artifacts and SHA-256 hashes. This is viewport evidence, not physical-device or browser-zoom acceptance.

The final production build including TypeScript/server bundle, full lint and 62 focused navigation/server-page/sign-in checks pass. A matching public release, installed review, remaining state/record returns and physical iPhone acceptance remain open.
