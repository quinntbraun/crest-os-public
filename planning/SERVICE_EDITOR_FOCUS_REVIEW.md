# Service editor focus timing

The published workspace journey sometimes reached the service discard check with the saved name still present and no unsaved draft. A targeted regression now focuses the real name field as soon as the editor appears, before the next animation frame. Both Chromium and WebKit failed this check on unchanged source908913f: the field lost focus. The diagnostic used genuine sign-in, services and product pages in an owned synthetic database; both cases failed, source stayed fixed and the owned database was cleaned up.

The editor scheduled heading focus with requestAnimationFrame. That deferred focus could run after field interaction began. Edit, Close editor and preview changes now use the existing layout-effect focus mechanism, which focuses the appropriate heading during the UI commit. Selecting the already active preview focuses its existing heading immediately. Service commands, dirty-state decisions, retained operation references, database rules and financial behavior are unchanged.

The regression is part of the original complete service-directory journey. It retains all four widths360/390/430/1440, draft/discard decisions, exact originating focus and scroll, pagination, resize, hidden-page clearing, accessibility and business/audit conservation assertions. Both complete original journeys pass2/2 on fixed001c65e, with source unchanged during execution and owned database cleanup verified. Build (including type checking), focused lint and68 service tests pass. This does not claim release or audit acceptance.

Evidence: .local/design-service-focus-before-auth/result.json and run.log retain the old-source0/2 reproduction. Earlier local non-reproductions and published workspace failures remain separate. The first attempt could not access Docker; the next reused evidence destination refused an exclusive snapshot write. Neither is counted as a product test result.

Successful follow-up: .local/design-service-focus-after/result.json and run.log. This resolves the demonstrated focus race; a fresh full public workspace group remains required.
