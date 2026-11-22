# Finance returns and recovery action priority

The Accounting setup tools now return to the section that opened them. Approval
and job-completion screens also give the current task priority over repeat loads
or navigation. These are local implementation changes; release acceptance is open.

## Accounting section return

Source b9c18c71c88d1f0e97d613d661a1e4e029dfd5fe accepts one known
Accounting view in the URL: accounts, reports or setup. Existing access and
feature checks still decide which sections are available. Unknown and duplicate
values fall back safely. Selecting a section updates the current history entry;
private clearing still removes loaded details and editor state.

Channels, tax, mapping lookup and category lookup share a “Back to finance
setup” return. The two original money-channel journeys and two original base
paid-expense/report journeys pass: 4/4, no skipped or cancelled cases. The channel
journeys exercise browser return, the shared return at 360/390/430/1440 pixels,
keyboard activation and disabled/invalid/duplicate view fallbacks. Inspection
makes no business request and preserves captured channel/audit facts. No optional
statement, supplier or income-statement variant is claimed.

Retained evidence: .local/design-finance-section-return/proof.json,
result.json, run.log and source-before/. Eight return captures are hashed; the
390-pixel Chromium capture was visually reviewed. Source stayed fixed and the
owned fictional database was cleaned.

## Approval and completion recovery priority

Source d185fee767d530897cba73860ae3744655cc62e5 changes only the visual class
of two application controls:

- Once an approval workspace is loaded, “Load approval settings” becomes
  secondary. “Approve mapping” keeps primary emphasis in fixed and category
  approval tasks. The initial load remains primary.
- “Open updated job in Schedule” becomes secondary while an original action
  remains pending or a confirmed completion has not loaded its saved summary.
  Original-outcome checking or “Reload saved completion” then has priority.
  Normal confirmed completion navigation remains primary.

The six complete existing browser journeys pass, 6/6, on that fixed source:
fixed approval, category approval and job completion in Chromium and WebKit.
The completion journeys retain the genuine full/partial saves, original-outcome
recovery, follow-up and subsequent original assertions. A single real successful
completion-context response is deliberately lost after the save; the interface
then reloads the saved completion successfully. No successful server reply is
fabricated.

The settled priority inspection checks one primary action, keyboard focus,
unobscured 44-pixel targets, no horizontal overflow and accessibility at
360/390/430/1440 pixels. Inspection issues zero business requests and preserves
the captured mapping/audit or job/audit facts. It restores the prior focus and
viewport. Six reports and 24 native captures are hashed in
.local/design-recovery-priority/proof.json; mapping and completion recovery
390-pixel Chromium captures were visually reviewed. Source stayed fixed and the
owned fictional database was cleaned. Types, full lint and production build pass.
The pending-known-receipt branch has source review, not a separately rendered
cleanup-failure acceptance case.

## Remaining work and release evidence

The S04 source scan covers 197 application TSX files and identifies 91 form and
165 outside-form action candidates. These are static candidates, including
mutually exclusive branches and independent task regions, not 256 simultaneous
primary actions. Existing phase-separated travel, cancellation and work-time
proof remains separate. The review found additional priority work in opening
receivables and statement matching: add/review actions can compete with saving.
Those changes and configured visual checks are next; S04 remains partial.
The shared URL return improves S13, but does not finish its full transition scope.

All three published bedc94f workflows are terminal. Commercial and expense checks
pass; the main run fails with 20/22 jobs passing. Workspace records is 55/56:
WebKit at 390 pixels retains the unsaved service name after the test tries to
restore the saved name. The stronger field/disabled-Save assertion now fails
before pagination. All 13 observed business responses are successful. This
narrows the problem to draft/input behavior; its root cause is not yet proven.
Foundation correctly stops at its mandatory prerequisite gate, so worker/container
acceptance did not execute. See .local/design-publication/bed-terminal-safe.json.

No aggregate ten-case acceptance on one source, complete audit acceptance,
installed comparison, physical iPhone check, merge, installation, financial
activation or real-data use is claimed. The audit stays 65 main local changes
addressed, three partial and two open, with every final sign-off false.
