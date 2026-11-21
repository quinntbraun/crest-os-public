# Statement recovery priority and configured browser zoom

The interrupted statement screen now puts its actual outcome explanation and **Check original save** before the retained balance review. The 110-character recovery reference opens in a native **Save reference** disclosure after that primary action. Retry remains secondary beside the retained review. A reload still offers the original lookup. No reference, retained evidence or recovery action is removed.

This is a render-only refinement in `src/app/settings/accounts/statement-staging.tsx`. Save/lookup handlers, pending-reference storage, recovery epochs, permissions, financial arithmetic, source formats and database rules are unchanged. The existing notice appears once, beside the recovery action while pending and in its previous position otherwise.

## Final source and verification

Application/test commit: `14553e8f9e5f383f6b81fe0954fd6c36257f04e8`.

- Production build, post-build type checking and full lint pass. Logs: `.local/statement-recovery-{build,types,lint}.log`.
- Both complete original Chromium/WebKit statement journeys pass, including real save-then-response-abort uncertainty, original lookup, saved lookup, file checksum, immutable financial rows and the current full-supplier source-export profile. Original deadlines, formats and recovery assertions remain.
- New regressions verify the original lookup precedes the long review; the reference starts collapsed, opens to the exact stored reference and closes with keyboard focus preserved. Opening/closing it makes zero business requests and leaves statement, journal and business-audit rows unchanged.
- A separate genuine Chromium case in the same frozen-source invocation passes **48 actual browser-zoom observations**: entry, balanced review, difference review, uncertain save, saved balances and saved evidence; four outer widths (720/780/860/1440) at 100%/200%. Narrow enlarged CSS widths include 360/390/430. Exact money labels, all form values, minimum 16px visible editable inputs, no horizontal overflow and whole-page accessibility checks pass. Zoom inspection adds zero business requests and preserves captured statement/journal/audit rows. Checking the original outcome preserves the committed rows without another posting.
- The whole invocation is **3/3 TAP parents**, zero failures/skips/cancellations. The complete original file contributes two parents; the zoom case contributes one. It is not a combined claim about other historical test files.
- Source stays unchanged through execution; browser/cookies/owned profile, fixture and owned database-cluster cleanup pass. **80 fresh hashed PNGs** are retained: 56 original-workflow captures and 24 actual-zoom viewports. Phone entry, difference/saved balances and uncertain-save viewports plus WebKit phone uncertainty were visually inspected.

Proof: `.local/design-statement-recovery-priority/{result.json,proof.json,run.log,captures/manifest.json}`. Final zoom details and archived case: `.local/design-configured-statement-zoom-final/{case-result.json,case-source.mjs}`. Final case SHA-256: `ec9654c44d778148329a88a019e75ce6c5b79679da29b8a8cd0c83c25e02a81b`.

## Capture corrections and retained earlier outcomes

Earlier accounting cases on `e5298ed` are separate evidence, not additional final-source observations. The first stopped after 16 observations because its test incorrectly expected discarded fields to remain populated. Source inspection and the corrected empty-opening assertion establish the remounted blank form; the fixture now refills every required field. The next attempt had a generated-case syntax error before the browser case executed. Both failures remain retained.

The v3 case passed 48 numerical/accessibility/conservation observations, but its scrolled images were not accepted as visual proof. Subsequent capture experiments preserve their outcomes: v4 failed at entry after two observations; v5 passed 48 but framing was unsuitable; v6 and v7 failed after two. Only v7's bounded diagnostic establishes its specific mismatch: the native capture surface was 1418×802 while the tested viewport required 720×900. Do not infer a cause for every earlier failure from that diagnostic.

App-free local probes reproduce differences between screenshot framing, native surface and actual zoomed DOM coordinates without Crest requests. The v8 case then passes 48 with correct framing on the older source. Final-source capture uses native DOM scrolling, the current browser surface, and alignment of only the owned browser window when its pixel dimensions differ. It verifies output dimensions and preserves the actual CSS viewport/DPR. No image resizing, CSS zoom, pinch substitution, business retry or relaxed assertion is used. Capture polling checks pixel dimensions only. The final images show the tested phone layout and fixed navigation correctly.

## Remaining scope

These six inspected financial views are not the eight S06 categories across every workflow. Empty/loading/denied/stale variants, other financial/long-name/history zoom states, WebKit actual tab zoom, broader motion/context work, matching published/installed acceptance and physical iPhone checks remain. The prior quote replacement deadline, provider/session failures and other retained failures are not diagnosed or cured by this refinement. All 70 original audit requirements and every false final sign-off remain; the audit count stays **60 main changes, 8 partial, 2 open**.
