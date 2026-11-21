# Quote directory and independent reading modes

November 19, 2026. Implements the main remaining R11/D03 layout changes from the November 17 end-to-end audit. This is scoped local evidence, not final audit or release acceptance.

## Result

Desktop owners can hide or show the saved-quotes directory while keeping the selected quote mounted. Showing it restores keyboard focus to its heading and preserves the search. Returning to the directory expands it and retains the existing phone return/resume behavior. These controls change local presentation only.

Edit keeps the side-by-side customer comparison when the actual quote workspace is wide enough. Preview is available at every width and uses the whole quote workspace, with a centered document capped at 48rem for comfortable reading. It no longer forces a long document into the narrow comparison column. Saved identity, version, date, dirty state and the saved/draft total remain outside the switched panes. Phone Edit/Preview preserves the same mounted draft.

The existing customer-safe document projection, exact pricing, explicit save, review/approval, accepted-family read-only rules, private clearing, pending references and save recovery are unchanged. No API, business rule, migration, financial activation or customer delivery behavior was added. Long retained text is not truncated, and private internal notes remain outside the customer preview.

## Executed evidence

- Production build, type checking and changed-file lint completed before browser execution; their successful shell sequence then launched the first owned runner.
- `.local/design-quote-reading-verified`: WebKit completed the original ten-step draft journey, including the new desktop no-request/no-write guard and five-width layout checks. Chromium failed earlier, before the new checks, when the original post-save reload could not verify access. The aggregate run failed: 12/14 reported cases. Its diagnostic counted 40 ordinary admissions, below the migration's 120/minute limit; this does not prove a rate-limit cause.
- `.local/design-quote-reading-confirmation`: Chromium completed the same ten-step draft journey. WebKit failed before sign-in completed, waiting for the authenticator field; its first step took about 971 seconds despite the reported 30-second locator timeout. The aggregate run failed: 11/13 reported cases. The cause of this timing/access failure is unconfirmed. No timeout, admission limit, authentication requirement or expectation was relaxed.
- Those two runs have identical before-source identities across all 2,467 tracked files, stable source during execution, and completed owned cleanup. They provide one complete passing draft journey in each engine, across separate failed aggregate runs; they are not a single all-green authentication-stability run.
- `.local/design-quote-reading-commercial-resumed`: both complete agreement, replacement and observation/review/approval journeys passed, six parent journeys and all 32 reported cases, with zero failures/cancellations/skips, stable identical pre-documentation tracked source and owned cleanup. All original privacy, immutable acceptance, exact approval, conflict, failed-read and interrupted-command assertions remain.

The new draft step compares actual business-scoped quote-family/revision rows and private audit rows before/after keyboard editing, directory collapse/show and preview switching. It requires zero `/api/business/` requests, unchanged rows, no pending save reference, preserved query and private draft, restored heading focus, and a wider selected workspace. It checks the changed title in the customer-safe preview without internal notes, then restores the original clean draft.

At 360, 390, 768, 1100 and 1440 pixels, the draft journeys check full Axe results, page overflow, readable saved-directory rows, 16px/44px inputs, keyboard focus, preserved title, whole-width Preview and the wide Edit comparison. Actual fixtures include a long unbroken address, 24 multiline Unicode scope paragraphs, two lines, a fixed quote discount, a zero-priced line with its explicit complimentary reason, private notes and the exact $120.55 total. The original history, downloaded private source, concurrent-edit, lost-acknowledgment, prospect and private-clearing steps also completed in each engine's passing journey.

Retained runtime-bounded captures: 15 in the first run, 14 in the second and 16 in the commercial/review run. The first total includes the earlier Chromium empty-state capture from its failed journey. The desktop reading and phone Preview captures were visually inspected; capture counts alone do not establish correctness.

## Interrupted observation

The preceding `.local/design-quote-reading-commercial-regression` runner disappeared without a terminal result; its original tool session was missing, elevated process inventory confirmed no test Node process, and Docker was stopped. Its retained source snapshot still matched all 2,467 current tracked files. No completed suite, source-after comparison or original cleanup was claimed. Its stopped, labelled, time-matching disposable container `d55f254370d36b8205616a8aa6f0ada8326f1c455538ff94f7444c9488bb77f8` was separately inspected and removed after Docker restarted. The unrelated older container was left alone. The resumed runner records its PID and owned container identity immediately to support future observation recovery.

## Remaining acceptance

After the browser source comparison and cleanup, the separate schema-120 recovery-test correction passed its complete independent restore case. Full type checking, full lint and all 9,005 unit tests in 383 files passed on the combined changes. The first restricted unit invocation failed 73 cases with local `connect EACCES` errors; its log is retained. The unchanged complete suite passed with local-network access, without changing assertions. See `SUPPLIER_RECOVERY_VERSION_REFINEMENT.md`; this test-support change does not retroactively turn the earlier failed browser aggregates into passing runs.

Additional many-line, unusually long, retained/denied/stale/pending and other state combinations remain explicit audit work. The access/sign-in failures remain retained without an asserted cure. Current complete hosted acceptance, preserved populated upgrade, installed-build comparison and physical iPhone checks remain required. The wider approved V1 functionality, native files, complete portability and recoverability, owner setup and release gates are unchanged. $0 new spending.
