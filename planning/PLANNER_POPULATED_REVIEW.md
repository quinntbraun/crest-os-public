# Populated planner review and layout refinement

November 19, 2026. Original D02 required a fresh signed-in day/week/month, selected-date, dense-day and overlap review. The earlier one-visit capture was insufficient. This review addresses that gap without changing scheduling or execution rules.

## Actual baseline

The opt-in synthetic fixture creates six independently accepted and booked visits. One pair overlaps by thirty minutes. Every booking uses the current mode version and the overlapping fixture reads the real protected slot review before recording an explicit synthetic owner override. PostgreSQL confirms exactly one overlap pair and one saved override. No appointment, reservation, decision or audit row is inserted directly to bypass business commands. Ordinary Calendar fixtures retain their previous nonoverlapping defaults.

`.local/design-planner-populated-baseline` passes the complete saved-booking browser file: six parent journeys covering Chromium and WebKit, unchanged source and owned cleanup, with 142 retained PNGs. The two added genuine-MFA parents review day, seven-day and month views, six actual loaded rows/date counts and selected jobs at 360, 390, 768, 1100 and 1440 pixels. Full Axe/overflow checks, exact phone return scroll/focus/date/view preservation, no business requests on local return and unchanged business/audit rows pass. Original saved-job history/download/refresh/privacy and customer-visit/vehicle-link journeys also pass. Chromium's existing native platform-font probe reports custom IBM Plex Sans semibold for its two specific calendar nodes; this is not proof for every text node or route.

Inspected populated phone/day/week and desktop/month/selected captures show:

- The full-width desktop calendar pushes the first actual appointment beneath the initial viewport.
- Before selection, a substantial empty inspector column keeps the six-row agenda unnecessarily narrow. After selection, the full-width calendar still delays access to the job heading and actions.
- The two saved overlapping time ranges are displayed identically to nonoverlapping rows. The owner must notice the overlap by comparing times.
- Phone selected-record return already retains exact scroll and focus. Preserve that behavior.

## Refinement decision

Group existing date/navigation controls into a compact desktop side column. Before selection, place the wider agenda beside it. Once a job is selected, keep calendar and agenda in the left column and place the existing job inspector at the top of the right column. Retain the phone's collapsed-calendar choice and record-detail replacement. Controls, fields and record state stay mounted; linked saved-job routes continue using their existing presentation. After a desktop view change, focus its selected mode button, with the agenda heading as the custom-range fallback.

Add a factual “Time overlap” cue to both affected loaded rows and a count qualified as loaded visits. Compare exact appointment microseconds only within each operator and exclude cancelled visits. Touching boundaries are not overlaps; different operators are not compared. This annotation does not infer travel intervals, availability, an unreviewed conflict, or whether a scheduling override should be allowed. The original protected slot-review and booking/change commands remain the authority for those decisions. Opening the saved job retains access to its recorded history. No mutation, migration, grant or new scheduling policy is introduced.

Seven focused unit cases cover both affected identities, touching boundaries, separate operators, cancelled visits, microsecond precision, unsorted nested intervals and empty/single pages without mutating input. The new browser baseline will additionally require exactly two visible cues, wide agenda/inspector alignment beside the compact calendar, readable expanded date fields, preserved mode focus and the original phone/data invariants.

## Verification and remaining acceptance

The first refinement run (`.local/design-planner-compact-layout`) is retained terminal 4/6, with unchanged source/owned cleanup and 74 PNGs. Both new populated cases caught the calendar's inherited 1.25rem top margin violating the original eight-pixel alignment requirement. Source and its original one-job month capture show the 20px offset. Removing only the wide sidebar calendar's top margin corrects the layout; the assertion and its threshold remain unchanged. The original four saved-job/customer-profile cases already passed on that source.

`.local/design-planner-aligned-current` then passes the complete file 6/6 in Chromium/WebKit, with unchanged source and owned cleanup. All five widths, actual 6-visit counts, exactly two overlap badges, full Axe/overflow, wide agenda/inspector alignment, expanded sidebar date readability/targets, desktop selected-mode focus and exact phone return focus/scroll/date/view/no-request/no-write assertions pass. The final desktop month/selected viewport captures were inspected. The earlier 142 baseline captures remain distinct from the refined-source evidence.

Production build, current type checking/full lint and all 9,021 regression cases across 385 files pass. Seven of those cases exercise the new exact-time annotation helper. These are scoped local checks; additional empty/error/denied/stale/recovery/long-value/zoom variants, current-source full release, installed upgrade and actual iPhone acceptance remain required. The original D02 dedicated review is now supported by genuine populated evidence and resulting refinements; final sign-off is still false. The complete original audit and approved V1 objective remain active. $0 new spending.

## Preserved release failure and UI expectation alignment

Published `fcf1caecd252c9cabf9941528e164d8d7b02b885` Phase 1 run `44485152112` and its bounded failed-jobs retry are terminal. The latest attempt has 21/22 successful jobs; Foundation `135448697670` fails at the required general browser suite, leaving six later steps skipped. Its original dependency failures/prerequisite refusal and every skipped result remain retained. Commercial and expense ancillary workflows pass. Do not retry the unchanged failing source blindly or infer container/document-worker release acceptance from earlier native successes.

The six paired desktop/mobile failures have three specific causes in the existing tests: the wordmark expectation still says uppercase “CREST OS” while the approved workspace displays “Crest OS”; the generic address status locator now matches the separately named editor and customer-search announcements; and the 404 test still seeks “Return to Crest OS” while the designed action is “Back to Today.” The two affected spec files now use the actual explicit names and exact home targets. The address case also verifies the customer-search announcement. No denied-response, no-store, nonce, prefetch, foreign-resource, accessibility, page-error or privacy assertion is removed, and no timeout/retry/project is changed.

`.local/design-workspace-policy-current` passes all 26 desktop-Chromium/mobile-WebKit cases against the corrected source, with unchanged source fingerprints; the owned test server's port 3000 is verified clear afterward. This is the actual unconfigured product/security suite, not genuine configured financial/provider or container/file-worker acceptance. A fresh full published-head release remains mandatory.
