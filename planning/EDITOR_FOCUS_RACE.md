# Editor focus before new input

November17, 2026. Functional follow-through on the audit's navigation/context requirements. No schema, controller, validation, save eligibility, authorization, privacy-clearing, conflict, audit or retry rule change.

## Reproduced mechanism and implementation

Vehicle/address transitions scheduled heading/button focus through requestAnimationFrame after changing the visible editor. That callback can run after the owner or an input driver has already selected a field. A controlled genuine-browser reproduction held the frame registered during Edit vehicle, focused Notes, then released it. Notes lost focus in both Chromium and WebKit. This establishes a deferred-focus race; it does not retrospectively prove the cause of every earlier hosted textarea failure.

Both screens now use their existing layout-effect focus request, guarded by the current controller, ready state and selected-record identity. Editor/profile/review/list targets are focused after their DOM commit and before paint. There is no later queued heading callback to steal new input focus. Review-to-editor restores the review action; list return restores the originating connected row or search fallback. An already-visible list receives immediate focus and leaves no stale request for a later update. Requests clear after handling; normal typing does not continually refocus headings.

Address/vehicle drafts and controller operations remain unchanged. Back/Return preserves an unfinished address draft; explicit discard still restores the saved snapshot. Original save references, exact values, privacy clearing and expected-version conflicts retain their original rules.

## Executed evidence

- `.local/design-vehicle-input-burst`:14/14 reported cases passed before the focus fix. A programmatic DOM-input probe changed notes and plate in one browser task, retained both values and made zero API requests. No same-task field-merge loss was reproduced; production edit/merge logic was not changed on that speculation.
- `.local/design-editor-focus-repro`: the delayed-focus check failed in both engines on the original application. Node reports10 passed/4 failed of14 because two failed editor subcases also fail their two parent suites. Source stability and owned cleanup passed; the negative log and source snapshot are retained.
- `.local/design-editor-focus-verified`:21/24 passed on the first fixed-source run. Both address/vehicle focus and draft/conflict checks passed in both engines. A later WebKit interrupted-save case failed while re-verifying access before its intended lost-save scenario; the following request reported Load failed. Their cause remains unproven. No guard/assertion was relaxed to accept them.
- `.local/design-editor-focus-final`:24/24 reported cases passed, zero failures/skips, unchanged tracked source and owned test-cluster cleanup. These are four complete genuine browser journeys (address and vehicle in both engines), with20 child cases and four parent aggregates. Existing exact-location/null/history/audit, multi-device conflict, original-receipt, archive/reopen, lost-reply, recovery-authority and revocation assertions remain.
- The controlled regression also verifies initial editor-heading focus, then chosen-field focus after delayed frames are released. Address checks retain the temporary instructions through Back/Return. The vehicle same-task field probe remains read-only.14 runtime-bounded address chooser/review/profile captures are retained with hashes; these are supporting presentation evidence, not a new visual redesign or physical-device proof.
- Test-only failure diagnostics keep at most32 fixed-route/status/transport events for each of two devices, plus the existing bounded editor/input/session flags. They add no API calls or write retries and serialize no response bodies, entered text, IDs, secrets or proof values.

Production build, full type checking, full lint and all8,952 unit cases/374 files passed. Complete exact-head hosted checks remain required.

## Hosted boundary and remaining scope

Publicc6678858 completed18/19 prerequisite groups; CRM134566522576 failed WebKit address instructions not retaining the temporary draft on Back/Return. Its vehicle cases passed. Foundation134577547090 stopped at prerequisite verification before dependency audit/build; both ancillary workflows passed. Earlier publicafb vehicle failure and the first local access failure remain retained evidence. Passing a later run does not establish their causes.

This local change fixes the independently reproduced focus race. It must not be described as complete resolution of all historical hosted failures before exact-source verification. Installed schema109, native-format worker, preserved upgrade, delivered review and physical iPhone gates remain unchanged.
