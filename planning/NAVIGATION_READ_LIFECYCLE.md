# Foreground schedule read lifecycle

The combined directory/navigation run retained20 cases:19 passed and WebKit amendment navigation failed the strict zero-page-error check. Bounded frame attribution identified /api/auth/session called through Schedule's initial read after Schedule/Back navigation. Customer/vehicle/service and dashboard cases all passed. This does not establish a business-save, quota or permission failure.

Schedule previously started loading before registering its page-hide/visibility handlers and did not check whether its initial effect was already running in a hidden document. It now registers the same privacy handlers first, then loads only in a visible document. An already-hidden mount uses the existing suspension state and requires an explicit reload when revisited. No read result is treated as an empty schedule.

The shared authentication transport also refuses an already-aborted request before calling fetch. It retains the same normalized uncertain result, bounded response handling, timeout, same-origin credentials, CSRF, no-store, redirect refusal and no-retry behavior. In-flight cancellation still reaches the real composed fetch signal. This avoids dispatching work already cancelled by a caller; it does not claim sign-in, logout or a business mutation succeeded.

The cancellation regression preserves both cases: pre-cancelled session/login/logout make zero requests, while in-flight cancellation aborts the one request and exposes no raw cause. The genuine amendment journey retains all original business, interrupted-save and strict zero-page-error assertions, with sanitized navigation-phase/public-bundle frame attribution. Full current-source browser acceptance remains required before calling this a verified navigation fix.

The24 focused authentication/schedule unit cases passed, including pre-cancelled zero-dispatch and in-flight cancellation. Both later genuine amendment journeys still preserved every business/source/recovery assertion, but the WebKit journey again failed the strict native page-error guard; the trace still points to the initial session read from the Schedule document during History Back. The lifecycle hardening has not established or resolved the native failure's root cause. It must not be described as a verified navigation fix.

Related upstream reports describe similar cancellation/lifecycle diagnostics, but do not prove Crest's cause: https://github.com/microsoft/playwright/issues/42823 and https://bugs.webkit.org/show_bug.cgi?id=289355. Next investigation should use a bounded independent lifecycle reproduction and distinguish actual JavaScript errors from native protocol diagnostics, without altering the current acceptance guard on speculation.

Status: defensive lifecycle/cancellation behavior unit-verified; complete navigation and release acceptance remain open. No schema, authorization, business rule or write-retry change. Installed schema109 is unchanged.
