# Readable action-priority changes

Public source dee6a1e2 run44202149497 records job134458700472 failed export accessibility when Check sign-in and load file list changed from dark primary styling to light secondary styling. The background was still interpolating while the text had already switched to dark ink: the hosted measured ratio was3.93:1. Later file-count assertions followed the interrupted first subtest and are not separate established export defects.

A local midpoint probe passed all10 genuine export cases; that did not prove the earlier transition frames readable. Holding the actual transition at its first frame then reproduced the Chromium defect at1.18:1 (ink#171e2d over background#202b46). That run retained6 passes and4 failures: the initial nested contrast failure, two dependent counter assertions and the parent. The WebKit journey passed. Both source snapshots and owned-cluster cleanup are retained.

Action priority now changes foreground/background atomically. Border, shadow and brightness feedback remain smooth; input background transitions remain unchanged. Existing reduced-motion support remains. This preserves both primary and secondary visual roles and prevents intermediate unreadable pairings instead of waiting beyond the failure or removing contrast checks.

The actual Next export regression observes the real class change, holds any background transition at its first frame, and applies the full accessibility rules before resuming it. Existing real-file byte comparison, no-storage-read-on-navigation, fresh recovery-pause refusal, audit evidence and binary handoff checks remain unchanged.

Current-source .local/design-export-priority-verified/result.json passed all10 genuine Chromium/WebKit export cases, zero failures/skips, stable source and owned-cluster cleanup. This includes the held first-frame contrast guard, full actual file-byte comparison and the unchanged read/recovery/audit assertions. Production build passed. Earlier midpoint and first-frame failures remain retained.

Status: contrast correction locally verified. The separate combined directory/navigation run passed19/20 and still failed its WebKit amendment page-error guard; complete release and installed acceptance remain open. Installed schema109 is unchanged.
