# Native fetch events during genuine navigation

November18,2026. Diagnostic observations only. The amendment test's zero-page-error guard is unchanged, and no native error has been silently excluded. Earlier lifecycle hardening remains defensive behavior rather than a verified cure; see NAVIGATION_READ_LIFECYCLE.md.

## Independent observations

The plain HTTPS experiment `.local/native-fetch-lifecycle` used a handled fetch, real pending request at History Back, both engines and routed/unrouted arms. All four arms caught cancellation, had no unexpected page errors or unhandled rejections and detected their uncaught-error positive control through both browser and document observers. This did not reproduce Crest and does not justify blaming or removing interception.

The genuine `.local/native-auth-navigation` observation used the real compiled application, disposable Auth/PostgreSQL, actual owner MFA, amendments and Schedule. Both engine collections completed; source stayed fixed and owned storage was cleaned. Four engine/routing arms performed three pending-read Back trials each. WebKit emitted one native fetch event while navigating away from the amendment document in the unrouted arm. Before positive controls, document error/unhandled-rejection counters remained zero; every arm's uncaught-error control was detected by both observers. This is not a zero-error navigation acceptance pass.

The subsequent `.local/native-auth-navigation-detailed` collection kept the same genuine setup and performed four trials per engine/routing arm,16 total, all with a session read pending at Back. It captured request failures, document lifecycle, native-event attribution and positive controls without inspecting tokens, headers, bodies, request parameters or arbitrary error text. Both collections completed, source was stable and storage was cleaned.

In the detailed unrouted WebKit arm, the native event occurred in the outgoing `/quotes/amendments` document during Schedule navigation, included the session-read location and preceded that document's pagehide by3ms. Back then cancelled the Schedule document's session request. Other recorded WebKit session failures were classified as cancellations during navigation. Document error/unhandled-rejection counters remained zero before controls; all four controls incremented the document error count and emitted a browser pageerror. Chromium emitted only its controls. The routed WebKit arm had cancellations but no native pageerror in this bounded observation.

These observations establish that at least one genuine native event is distinguishable from the positive-control JavaScript exception and can occur without interception. They do not establish the cause of every hosted event or prove the full amendment workflow ready. Clearing drafts earlier in beforeunload merely to avoid a browser diagnostic would risk cancelled-navigation data loss and is not an adopted change.

## Next verification

Carry the same bounded document-error/unhandled-rejection and request/lifecycle attribution into the full genuine amendment journey while retaining the current guard. Require a causal match before considering any correction to event classification. Genuine uncaught exceptions, unhandled rejections, active-document failures and unexplained native errors must still fail. Do not add a broad `Load failed` whitelist, disable routing speculatively, relax security/admission limits, add automatic retries or treat collection exit0 as application acceptance.

Related primary reports describe different reproduction scopes and remain context rather than Crest's cause: [Playwright42823](https://github.com/microsoft/playwright/issues/42823) concerns WebKit/Windows pending Next prefetches; [WebKit289355](https://bugs.webkit.org/show_bug.cgi?id=289355) concerns a legacy macOS navigation test and was closed with the WebKitLegacy test reduction. Neither proves a Crest fix or excuses its remaining release/device gates.
