# Clear task entry screens

November 17, 2026. Implements the latest audit's missing-selection refinements for booking, work status, completion, interruption, cancellation, mileage and recorded work time.

A shared task-entry surface explains the specific prerequisite, presents the existing destination as its primary action, and describes the next two steps. The action precedes the guide on phones; wide layouts place the guide beside the task. These are informational steps, not saved progress or a claim of job eligibility. Mileage also links to existing standalone travel. No job, time, distance, agreement, communication or business record is invented.

Booking and field controllers expose an explicit selection-needed presentation flag only after their existing authentication, pending-save, blocker and feature checks. It resets with private state. This avoids interpreting every blocked state as a missing selection. Booking reload remains available for other blocked states even if the agreement link is missing. Mileage distinguishes missing context only after its current access/capability and own pending-save checks, with recovery and denied states retaining their existing actions. Recorded work time retains its existing missing-job behavior and original-review paths.

No schema, permission, accounting or save/retry rule changes. The full latest-audit, exact-source release, preserved upgrade and physical-phone requirements remain open. Browser emulation cannot establish physical iPhone behavior.

Final local verification: type checking, full lint, production build and all8,946 unit tests/372 files passed. The52 focused controller cases include missing selection versus denied access, disabled capability and original pending references. All eight genuine Chromium/WebKit booking, field and mileage journeys passed with no failures/skips, stable source and owned-resource cleanup.

The entry review covers seven destinations at360/390/768/1100/1440px in both browsers, full Axe checks, no overflow, primary actions above phone navigation, keyboard focus and actual return hrefs. Refused workspace reads retain existing reload/error controls instead of showing selection guidance. Job and business-audit snapshots remain unchanged. Seventy immutable captures, hashes and the actual served-font report are retained in `.local/design-task-prerequisites-verified`. Chromium identifies custom IBM Plex Sans SmBld on the actual booking heading and action; other configured typography, long text and zoom/device states remain separate review work.
