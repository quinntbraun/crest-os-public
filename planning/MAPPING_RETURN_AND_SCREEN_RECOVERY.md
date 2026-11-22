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
The lookup date never fills an approval's effective date. Existing private
clearing still removes loaded results, history, selections and dates, including
the persisted-page path.

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
