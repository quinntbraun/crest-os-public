# Standalone travel history and focused records

November18,2026. Implements the latest audit's standalone-travel/history direction against current source. Existing date-grouped journeys and departure/arrival facts were retained and refined. No schema, API, work-session transition, accounting rule or save/recovery protocol changed.

## Presentation and navigation

The selected journey now replaces the date-grouped directory on phones/tablets. Back to trips restores the original trip button, or the recent-trips heading for an automatically selected save. Directory date disclosures stay mounted and retain their state. Desktop keeps the selected journey beside the directory; sufficiently tall desktop views keep the directory visible while reviewing longer evidence. Unselected desktop space explains the history task without opening a private record automatically. Active trip and its safe next action remain above past trips.

Saved versions are ordered by sequence, earliest to latest, with explicit loaded-history coverage. The first version is a compact original route; later versions show the exact changed fields against their immediately preceding loaded version. Actual reason text and recorded time accompany the update. The transport does not identify every originating command, so the UI does not label every version as a correction, arrival or another inferred event. State/outcome is shown as the saved fact.

The pure presentation helper refuses cross-trip and skipped-version comparisons. It retains nulls, whitespace, line endings and subsecond differences rather than rounding or cleaning evidence. Local readable timestamps show seconds in the saved business time zone. Changes to time also expose the exact source timestamp, and every version retains full route/details, exact UTC times, vehicle and version references behind its native disclosure. Download still requests and verifies the same bounded original JSON history; mileage retrieval and export are unchanged.

An unfinished correction remains mounted when returning to the directory. A visible return-to-correction task restores it without a request. Opening another history or performing another trip action asks before discarding the local correction; declining preserves it. Dirty correction state registers the standard browser leave warning. Existing suspension/disposal still clears private in-memory state; this refinement adds no persisted draft or filter. Review/back/start/selected-record focus now uses committed DOM or an already mounted control rather than queued animation-frame heading focus.

## Verification

- Final owned `.local/design-travel-history-polished` run passed both complete genuine Chromium/WebKit product workflows2/2 with zero failures/skips, stable tracked source and owned-cluster cleanup.102 runtime-bounded final-source captures and byte hashes are retained: active trip, history, changed facts, mileage, directory at360/390/768/1100/1440px, plus the actual trip review in both engines. Representative focused-phone changes, desktop sticky history and multi-day directory views were visually inspected.
- Existing departure/arrival, WebKit lost reply/original confirmation, single arrival submission, retained actual timestamp/notes, saved/proposed correction, exact JSON export, mileage CSV/JSON and cancellation assertions remain. The final database assertion still proves no unrelated job was created.
- New browser checks cover focused-record Back/return, late-frame focus release after Review trip, visible before/after destination and full exact timestamp, no-API evidence disclosure, retained dirty correction after Back, declined switch with no request, accepted local discard to inspect another trip, and unchanged actual travel/audit snapshots.
- Accessibility checks now include the entire Axe result rather than the prior selected tag subset; all five widths retain overflow and opening-view arrival-action reach checks. Six focused units cover exact/null/whitespace values, adjacent arrival facts without command inference, cross-trip/gap refusal, nonmonotonic recorded times/reason-only updates and subsecond differences.
- Final source passed types, full lint, production build and all8958 units/375 files.

## Retained failed runs and limits

`.local/design-travel-history-verified` failed both cases because the new comparison assertion looked inside the newly loaded version disclosure before opening it. `.local/design-travel-history-final` then reached the new later draft test but failed both cases because a text-only selector matched both the correction disclosure and its form legend. The test now opens the specific disclosure and uses its summary; no application or accessibility/business assertion was relaxed. Both runs retained stable source and cleaned their owned clusters. Visual review also condensed the duplicated original-version route before the final complete run.

This proves the local history/navigation refinement, not every loading/empty/denied/stale/pagination variant, preserved installed upgrade or physical iPhone behavior. Native document formats, exact-source hosted/full release, remaining audit routes/states and the complete approved V1 functional objective remain required. Installed schema109 is unchanged.
