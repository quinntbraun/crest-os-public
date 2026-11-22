# Genuine accounting report loading

Income, ledger, customer-funds and receivables readers now share a compact placeholder for the real in-flight report read. It contains no figures, report scope claims, fake progress or minimum wait. Existing readers still clear the previous snapshot before requesting a new one. The placeholder disappears on success, failure, privacy clearing or cancellation; the verified report header retains its existing focus behavior. Income and ledger now expose the same busy accessibility state already present in funds and receivables. Journal-only reads keep their existing checked balance and do not replace it with this placeholder.

The shared design uses the existing workspace animation and global reduced-motion override. Dates remain mounted and disabled while checking. No accounting, authorization, API, database, CSV or save/recovery rule changed.

## Executed verification

- Production build (including TypeScript and server bundle) and full lint passed on application source `51ccea2`. The only subsequent code change is coordination of the browser test gate, separately syntax/lint checked.
- Complete original income/expense browser journeys pass **2/2** on `f30e768afc109442df675f72837e8389401a4f99`, one Chromium and one WebKit case. Existing financial, journal, CSV, denied-access and safe-return assertions remain. Original test deadlines were not increased.
- New income and ledger checks hold a genuine request before forwarding it unchanged. They verify busy state, absence of stale headers/downloads, disabled date controls, visible placeholders at 390/1440px without horizontal overflow, and disabled animation with reduced motion. Loaded-report checks confirm placeholder removal and retain the existing five-width reading review.
- Eight loading screenshots are copied and SHA-256 indexed in `.local/design-accounting-loading-states-coordinated/captures.json`. Native source remained fixed and the owned temporary database was removed. Phone income and desktop ledger captures were visually inspected.

## Retained failure and limits

The first invocation `.local/design-accounting-loading-states` failed **0/2** on `51ccea2`: its ledger gate removed the handler before `route.continue()` completed, producing “Route is already handled”. That unhandled test failure left fixture roles which correctly blocked the next browser. No ownership guard was bypassed. The wrapper completed, verified unchanged source and removed its owned cluster. Four rendered loading captures remain retained with that failure. The correction awaits actual handler completion before removing it; it changes no application behavior or assertions.

This verifies the two rendered report-loading consumers and their complete original journeys. Funds and receivables use the same component but are not claimed as a new four-report loading capture matrix. It does not complete S06's broader important-workflow state review, installed acceptance or physical-iPhone review. Audit counts remain 67 main local changes addressed, one partial and two open; no final sign-off changes. The published candidate `6b198bc0` precedes this local change and requires its own release evidence.
