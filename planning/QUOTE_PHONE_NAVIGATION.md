# Focused phone quote navigation

The design audit identified a real quote-screen gap: unlike customers, vehicles, addresses and services, opening a quote on a phone left its saved directory above the editor and agreement. Long lists and accepted documents made the main task unnecessarily distant.

At widths below760px, the saved directory and current quote now occupy separate views. Desktop keeps the existing side-by-side layout. Opening or creating a quote focuses its heading. Back to saved quotes reveals the same mounted directory and restores focus to the originating row/control when it still exists. Search text, results and current editor are not remounted merely to switch these views.

Returning to the directory submits no command and does not discard a draft. A visible Continue unsaved quote / Return to open quote control resumes it. Selecting the same family with unsaved changes resumes its current draft without an automatic read or write. Selecting a different quote or creating another retains the existing discard confirmation. Normal read-only, stale, pending-operation, commercial verification and write-lock rules remain unchanged.

This retains private draft state in the already-open page only. It adds no browser storage, autosave, offline write, history mutation or permission. Existing tab-hide/page-leave/reload suspension still clears private details and retains only the established interrupted-operation reference where applicable. A saved or accepted quote is not changed by navigation.

Required acceptance: real Chromium and WebKit draft/review/commercial journeys; new and saved unsaved-draft return/resume; original-row focus restoration; no quote read/save requests on same-draft resume; phone directory/detail separation at360/390px; preserved side-by-side desktop layout at768/1440px; retained long content, accessibility, history, download failure, conflict, lost acknowledgment, review, agreement, replacement and private-state clearing cases. No existing business assertion or test case is removed.

## Executed evidence and open checks

The first combined local run retained52 cases:48 passed and4 failed (two failed nested steps plus their parent journeys). All four agreement/replacement workflows passed. The failures were a Chromium access read after Browser Back and WebKit review reauthentication. Both affected journeys subsequently passed in isolation:17 cases, zero failures/skips, unchanged application safeguards and stable source.

A stronger combined run added saved-search preservation, focused record/directory viewport captures, and a fresh-code/single-submission reauthentication check. Its45 executed cases included41 passes and4 failures. Both review journeys and the WebKit editor passed; WebKit replacement saving remained disabled and Chromium's first draft save refused an unverified access context. Numeric diagnostics showed34 recent ordinary admissions for the latter failure, below the120-per-minute guard, so request quota is not its established cause. Earlier failures remain preserved; these runs do not constitute complete combined acceptance.

Failure-only diagnostics now include the test provider's existing fixed error category and SQL state. They are bounded and exclude raw messages, SQL parameters, credentials, identifiers and provider responses. The remaining local failures require investigation and hosted comparison. Do not widen expected-success messages, retry business writes automatically, alter authentication/admission/CSRF rules, or call the candidate accepted.

The current-source diagnostic run then passed both latest affected journeys (WebKit replacement and Chromium draft):13 cases, zero failures/skips, stable source and owned-resource cleanup. The Chromium editor proof includes retained saved-search text, original-row focus, new/saved unsaved-draft resume, no quote read/save on same-draft resume, and fresh focused phone captures. Current type checking, lint, production build and all8,936 unit tests passed. The updated phone record/directory captures were visually inspected. These isolated results do not erase either mixed combined run or establish complete hosted acceptance.

Status: locally implemented and checkpointed for hosted verification. Complete combined hosted acceptance, dependency-audit acceptance, installed upgrade and physical iPhone remain pending.
