# Readable Today entry transition

Hosted report source960312e9 run44197656572, schedule job134443214948, failed one WebKit color-contrast check in the pending-appointment Today view. The normal local comparison passed both scheduling journeys, so a resting screenshot did not establish the cause.

The Today content entry animation began at opacity0.8. Holding that real first frame reproduced failures in both browsers: supporting text and appointment details measured3.99:1 on the panel, footer helper text3.82:1 on the canvas and the footer recovery link4.41:1. Each is below the required4.5:1 for its text size. The exact selectors and measured colors are retained in .local/design-today-first-frame-before/run.log. Both cases failed as expected; source was stable and the owned cluster was cleaned.

Today now uses the existing short movement transition. Text remains fully opaque throughout. The unused fade keyframe is removed; existing reduced-motion rules remain in force. No loading state, access check, financial value, scheduling reservation, write, recovery behavior or business rule changes.

The browser regression pauses the actual content animation at its first frame and runs the full existing accessibility rules before resuming it. All ordinary four-width captures and genuine proposal, confirmation, withdrawal, conflict and cancelled-job recovery assertions remain. This adds a stronger visual-state check; it does not wait past the failure, disable motion for the audit or remove a contrast rule.

Current-source .local/design-today-first-frame-verified/result.json passed both complete journeys, zero failures/skips, stable source and owned-cluster cleanup. Production build and targeted test lint passed. Complete exact-source hosted release and installed acceptance remain required.

The same hosted source's CRM job134443215493 separately failed WebKit vehicle editing when Save vehicle remained disabled (vehicleEditorFlow line84). Its cause is not established by the contrast result and must be investigated independently. Foundation checks failed the prerequisite gate; the dependency audit was not reached on this run. Do not report the previous dependency failure as a newly executed result.
