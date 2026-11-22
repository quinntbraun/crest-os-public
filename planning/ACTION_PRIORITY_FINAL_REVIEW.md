# Action priority: main local review

S04's main local change is addressed. This reconciles the complete application
source review with the scoped rendered evidence below. It does not establish
every state on the final delivered release; S06, release and device acceptance
remain separate and every final sign-off remains false.

## Whole-source review

The inventory covers all 197 application TSX files, 147 explicit forms,
91 apparent primary candidates inside forms and 165 outside them. It retains
file hashes, labels, conditional classes and enclosing conditions in
.local/design-action-priority-complete/final-source-candidates.json, confirmed
against source 5ea9dd3567194c3ecb11cb59d691eb990aaa94d1.
Counts identify review candidates; they do not count simultaneous rendered
actions or prove visual acceptance.

The three forms with multiple candidates are travel correction, cancellation
and work-time correction. Their details and confirmation stages are mutually
exclusive. FIELD_TASK_FINISH_REVIEW.md retains the actual stage observations,
including the separate 11/12 and subsequent 4/4 scopes.

Outside-form and composed actions were reviewed by their real task boundaries:

| Task family | Priority rule checked |
|---|---|
| Customers, vehicles, addresses, leads, sources, services | Directory creation and record editing are separate regions. Refresh/pagination is secondary when records exist; sole unavailable-record recovery and original-outcome checking remain prominent. |
| Quotes and amendments | Draft, review, approval, sharing, acceptance and replacement actions are gated by their respective states or independent forms/disclosures. Retry stays secondary to original-outcome checking. |
| Booking and job changes | Confirmed job navigation is primary; a known receipt with pending local cleanup makes navigation secondary to checking the original. Existing conditional classes already enforce this. |
| Work, travel, mileage, time and custody | Entry/review/commit stages retain one task action. Loaded queue maintenance is secondary. Empty work-time points to work status. Completion recovery now outranks job navigation. |
| Financial posting and corrections | Each independent financial form keeps its commit action; original-outcome checks outrank eligible retries. Downloads and loaded review refreshes use secondary styling. |
| Account/channel/tax/mapping setup | Initial access/load can be the task. Once loaded, refresh is secondary to Add/Approve/Save. Initial and pending recovery controls keep their appropriate priority. |
| Opening balances and statements | Add/review/save emphasis follows the current stage. A saved preview gives Save priority over reviewing again. Optional adding stays available as a secondary task once work is ready to save. |
| Export and Save review | Prepare/Save ZIP and review/verification/retirement are phase alternatives. File-list loading and saving a selected export are independent regions. Dynamic classes preserve the current task. |
| Today, navigation, settings and sign-in | Independent visit/follow-up cards and navigation/search controls are distinct tasks. Sign-in, required access checks and focused settings forms retain one primary action. |

The shared secondary styles and workspace overrides preserve contrast and target
size. The red field-cancel submit style is used for the actual reviewed job
cancellation; ordinary edit, transfer, close, retry and download controls are not
made destructive merely to distinguish them.

## Final application changes and verification

Application 8b1db4d makes the Add receivable action secondary while a schedule
already has lines, and Review secondary once a savable preview exists. When saved
receivables have not yet been loaded, Review remains the primary available stage.
Statement matching makes Add secondary when a writable changed draft offers Save;
read-only preview tasks retain their Add action. These are class changes, with
financial handlers, validation, references and database behavior preserved.

The same application change moves Services' return-to-editor focus from a queued
animation frame into its existing layout effect. The registered service journey
checks that the visible field retains focus across subsequent frames, restores
the saved name, disables unchanged Save and then completes the original return,
pagination, resize and private-clearing checks at four widths. This removes a
late focus handoff; curing the published Linux WebKit failure remains unproven.

Executed evidence stays explicitly scoped:

- .local/design-final-action-priority: 4/6. Both complete statement-enabled
  paid-expense journeys and both four-width service journeys pass. Two opening
  cases stop before browsers because this first runner omitted required scenario
  prerequisites. Twenty statement/service artifacts are hashed in proof.json.
- .local/design-final-opening-priority: 0/2. The new inspection incorrectly
  expected Add after the UI correctly closed the completed entry form.
- .local/design-final-opening-priority-corrected: 0/2. The new snapshot helper
  queried statement-draft tables absent from the opening-only schema.
- .local/design-final-opening-priority-profiled: 2/2 complete original opening
  journeys on 5ea9dd3. Corrected inspections follow the actual closed-entry
  transition and use explicit workflow-specific required tables; no absent-table
  skipping is used. All original financial recovery/export assertions remain.
  There are 24 native captures and six reports, all hashed; the 390-pixel saved
  preview was visually reviewed.

All four invocations retain fixed-source snapshots and successful owned-cluster
cleanup. Later changes after 8b1db4d affect tests only: application source is
identical. The final opening inspections cover review, save and review after
re-entry at 360/390/430/1440 pixels: one primary, focused/unobscured 44-pixel
target, no overflow or accessibility violations, zero inspection business
requests and unchanged captured journals/worksheet/schedule/audit facts.

Production build, type checking and full lint pass for the application change.
The final changed test/helper files also pass lint. No full unit-suite rerun or
single combined six-case acceptance on the final test revision is claimed.
Prior d185fee approval/completion 6/6 remains separately scoped in
FINANCE_SECTION_AND_RECOVERY_PRIORITY.md.

The audit now has 66 main local changes addressed, two partial and two open.
S06 still needs the remaining eight-state reconciliation. S13 still needs
alternate/outdated transitions and matching release behavior; mapping lookup
currently loses purpose/category/date when returning from approval management.
Published bedc94f remains unaccepted with its service-editor failure. No merge,
installation, financial activation, real Crest data or spending occurred.
