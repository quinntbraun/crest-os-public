# Readable expense revision evidence

November17, 2026. Local implementation of the latest audit's readable expense-history refinement. No schema, financial rule, record mutation, new endpoint or installed-preview change.

## Presentation

The saved expense's existing History disclosure now contains retained revision rows, newest revision first. Each shows its exact saved USD amount, initial/correction/void label, recorded time, distinct payment date and retained reason. A void explicitly retains the original amount as historical evidence rather than displaying zero or implying deletion.

Each correction can disclose before/after purchase fields. Comparisons use adjacent revision numbers for the same business and expense, never wall-clock order or a guessed missing predecessor. Amounts use the existing exact cents formatter; missing optional values say Not recorded. Reason changes remain readable independently of purchase-field changes.

Saved values and exact evidence remain expandable for each revision: original payload values, full six-digit UTC recorded timestamp, actor reference and operation reference. No actor name is invented. The compact recorded-time label explicitly says UTC; payment dates remain date-only. All text is rendered as text, with long values/newlines retained and wrapping allowed.

One timeline surface and simple dividers replace prose paragraphs. The comparison uses a two-column Before/This revision layout with a field label above, including on phones. Exact evidence is secondary. Original save/recovery, correction/void/posting protections, receipt behavior and expense CSV remain unchanged.

## Verification

- Three focused unit cases passed: exact value/null/newline comparison without mutation; refusing comparison across businesses/expenses/revision gaps; and void amount preservation plus revision ordering despite nonmonotonic recorded time. The full suite passed all8,952 cases/374 files.
- Final type checking, full lint and production build passed.
- `.local/design-expense-history-verified`: all5 cases passed, zero failures/skips, source stable and owned test-cluster cleanup confirmed. This includes four genuine Chromium/WebKit owner-expense journeys plus the existing editor UI fixture.
- The existing genuine save/lost-reply/reload/correction/void/export flow now inspects newest/oldest ordering, exact correction and void differences, retained reasons, six-digit timestamp evidence and keyboard-operated disclosure. Five-width Axe/overflow captures cover360,390,768,1100,1440px. Opening/inspecting history sends zero API requests and leaves expense revisions/audit snapshots identical.
-38 runtime-bounded captures are retained with hashes:10 expanded history captures,20 directory states and8 existing expense states. Desktop and phone histories were visually inspected. Full-page screenshots can show fixed navigation at a capture boundary; that alone is not evidence of a viewport overlap defect.

## Remaining work and delivery

This is local expense-history presentation acceptance, not all financial histories, all error/stale/denied states or full release acceptance. Commercial, custody, travel and payment histories, accounting setup, document-native formats, exact-source hosted checks, preserved upgrade, delivered-build and physical iPhone checks remain open in DESIGN_AUDIT_FINISH_REGISTER.md.

The public expense-directory source afb4544c remains under its existing hosted runs44229977333/44229977317/44229977304. Do not replace/cancel/restart a live verification run. This local history change must not inherit predecessor acceptance. Installed schema109 is unchanged; no spending or real-data activation.
