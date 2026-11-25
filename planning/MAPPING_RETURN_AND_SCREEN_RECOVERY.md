# Mapping returns and unexpected-screen recovery

The mapping lookup now preserves its selected purpose/category and lookup date
when opening approval management and returning. Unexpected route/layout errors
also have a branded recovery screen. S06 and S13 remain partial; these changes
do not establish complete screen-state or release acceptance.

## Mapping context

The new mapping-navigation module accepts only a known purpose from the correct
fixed/category family and a valid lookupOn calendar date. Duplicate values,
cross-family purposes and invalid dates are rejected. Generated destinations
are fixed internal routes; unrelated identifiers, notes, approval dates and
redirect parameters are excluded.

Lookup selection/date changes replace the current history entry with that safe
context. A contextual approval-management link carries it forward. Management
pages preselect the purpose, keep the established breadcrumb wording and return
the original lookup context. Returning focuses the selected category heading or
purpose control after hydration. Generic management entry remains available.
The lookup date never fills an approval's effective date. The later lookup-return
follow-up preserves only the static purpose/category, lookup date and finite
category attention filter through private clearing. Loaded results, history,
account details and custom search text still clear, including the persisted-page
path. Approval-editor drafts remain separate and are still cleared. See
[the follow-up scope and evidence](MAPPING_LOOKUP_PRIVATE_RETURN.md); earlier
evidence below applies to its recorded source, not automatically to that change.

Application 32ac051 introduced the feature. Application abedcc9 restored
established breadcrumb labels and moved the new link inside the lookup form,
preserving the original desktop form/history alignment. Application b31344d
adds the error screens below; mapping application behavior is unchanged.
Test-only 9d05d51 waits for the real lookup to be ready before dispatching the
private-clearing probe. Application 4baa4a7 changes only initial lookup guidance
so it remains accurate with a restored selection.

The four navigation unit contracts pass. The browser evidence remains separate:

- .local/design-mapping-return: 0/4. Original category tests catch the changed
  breadcrumb wording; original fixed tests catch the shifted desktop form.
- .local/design-mapping-return-final: 1/4. Chromium category passes; WebKit's new
  keyboard probe acts before enabled controls, and Chromium fixed receives a
  genuine sign-in-again result during the extra review. That denial's cause is
  not proved or declared fixed.
- .local/design-mapping-return-hydrated: 2/4. Both complete Chromium journeys
  pass. The new navigation check uses an independently signed-in fictional
  browser context and waits for enabled review controls. Both WebKit journeys
  reach the new private-clearing probe before lookup hydration completes.
  Its proof retains 34 hashed artifacts, including partial WebKit observations.
- .local/design-mapping-return-webkit-ready: 2/2 complete original WebKit
  journeys pass after the inspection waits for the lookup's ready control.
  Its proof retains 16 fresh captures and two reports.

Every invocation retains fixed-source evidence and successful owned-cluster
cleanup. Both families/browsers are covered across the 2/4 and 2/2 scopes, not a
claimed single final-source 4/4 run. Original assertions, deadlines, authentication,
request limits and accounting rules are preserved.

The checks cover real browser Back, explicit return links at
360/390/430/1440 pixels, exact safe URLs, restored selection/date/focus,
44-pixel unobscured return targets, no horizontal overflow or accessibility
violations, invalid/duplicate queries and private clearing. An explicit genuine
approval read confirms the draft's effective date is blank. The subsequent
four-width return inspection issues zero business requests; all captured
mapping versions and business audit rows remain unchanged. Credentials stay in
memory inside the owned fictional fixture. The WebKit 390-pixel category return
capture was visually reviewed.

## Unexpected errors

error.tsx and global-error.tsx use WorkspaceRecovery and existing missing-page
styles/logo. The heading receives focus. Reload delegates to the framework's
screen reset; Save review and Today remain explicit links. No financial command
or automatic retry is introduced, and error messages/digests are not rendered.
The fifth unit contract verifies private exception text stays out of both pages.

.local/design-exception-recovery-visual/proof.json records eight isolated
actual-component observations in Chromium/WebKit at the same four widths.
Actual logo loading, initial heading focus, unobscured 44-pixel reload control,
no overflow/accessibility violations and exactly delegated reset callbacks pass,
with no external/business requests or page errors. Source hashes remain exact;
the public-assets-only server and browsers are cleaned. Phone Chromium and
desktop WebKit captures were visually reviewed.

This is component evidence, not an injected Next exception or full root-layout
failure acceptance. Early preview setup/interop/image-readiness failures are
recorded in the proof limitations; existing Vite and the real Next Image module
are used without new dependencies or an image replacement.

## Remaining acceptance

Finish the remaining important-workflow eight-state matrix, alternate/outdated
task transitions and real unexpected-exception coverage. Publish the coherent
tested changes to the existing draft and require fresh exact-source CI,
especially the unresolved Linux WebKit service-editor case. Delivered/installed,
owner finance, off-laptop recovery and physical iPhone acceptance remain open.
The audit remains 66 main local changes, two partial and two open; every final
sign-off is false. No merge, installation, activation, real data or spending.

## Subsequent genuine Next faults and session returns

This update supersedes the earlier component-only/reset-delegation limitation
for the specific route/root failures tested below. It does not close global
eight-state, installed or physical-device acceptance.

Actual Next fault injection exposed two application defects: the framework
reset replayed the cached failed server result, and the root fallback lacked
a document title. Application674b820 changes both recovery actions to a fresh
GET reload;11b11ad supplies root document metadata. Reload submits no financial
command. A wired callback unit contract prevents reverting to the cached reset.

.local/design-next-exception-accepted/proof.json passes16 actual route/root
failure observations in Chromium/WebKit at360/390/430/1440 pixels and four
successful GET-only recoveries after the controlled fault is removed. Focus,
44-pixel targets, private error omission, actual logo/fonts, accessibility and
overflow pass. No business/external requests occur. All tracked source remains
unchanged and owned servers/browsers are cleaned. Faults exist only in an owned
source copy; no production debug route or fault switch was added. Phone route
and desktop root captures were visually inspected.

Earlier cached-reset and missing-title failures remain retained. A separate
WebKit diagnostic proves the screenshot tool injects a nonce-less body{} style
that strict CSP correctly blocks. Accepted observations use fresh documents,
assert application CSP violations are absent before tooling and separately
record those blocked tooling styles. Security policy was not relaxed.

Applicationcf2aeb9 adds a shared SignInLink to31 generic recovery links across
30 screens. Its finite known destinations preserve only validated record/date/
section/planner metadata. Duplicate, malformed and arbitrary redirect values,
private fields and write-operation input are excluded. Original interrupted-save
resume priority and explicit existing recovery links remain. A write-task return
opens the saved job for fresh review. The anchor does not authorize, save, load
a financial record or depend on a router in standalone fixtures.

Explicit denied access now clears a prior mapping confirmation (cf2aeb9) and
loaded lookup/directory/checked state (43c9c0a), preserving safe navigation and
original pending-reference handling. A failed history read after session loss
therefore cannot leave a previously approved account visible or falsely report
that no mapping exists. No financial rule, request limit or permission changes.

Sixteen focused unit contracts, type checking, full lint and production build
pass. Browser evidence remains separate: .local/design-sign-in-context finishes
2/4 with both complete fixed-mapping journeys passing; the two category fixtures
fail application startup while a concurrent normal build replaces shared Next
output. That runner ordering mistake is retained, not an application diagnosis.
After the build completes, .local/design-sign-in-category-lookup passes both
complete original category journeys2/2 on frozen43c9c0a, with no skips or
cancellations. The scopes are not aggregated into one4/4 run. Each retains
18 hashed captures/reports and unchanged source/owned database cleanup.

The new checks lose real fixture cookies, clear private approval results, sign
back in with genuine fictional MFA, preserve purpose/lookup date and restore
selection focus without loading private approvals automatically. Fixed mapping
also reopens an actual committed receipt before denial to verify its removal.
Category lookup verifies an actual approved5100 account disappears after a
denied history read, the false empty state stays absent and sign-in retains
the original safe lookup date. Mapping versions and business audit rows remain
unchanged. Original financial/export/recovery assertions and deadlines remain.

Published726 Linux workspace-records137091537177 passes56/56, including the
previous service case; accounting-settings137091537148 passes10/10. All21
workflow prerequisites and the separate commercial/expense workflows succeed.
The Foundation job remains in progress at this checkpoint. Those checks cover
public726, not the subsequent local session/error fixes. Keep public head and
draft metadata frozen while any exact-head workflow is live.

S06/S13 remain partial: reconcile remaining important workflow states and
alternate/outdated contexts, then require matching delivered/owner/device
acceptance. All70 original requirements and false final sign-offs remain.
