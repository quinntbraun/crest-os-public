# Browser dependency download deadline

Public97c main45153513036 has confirmed failures before application tests:
income-statement137620582116 and commercial137620582837 step8. Auxiliary
commercial137620581462 fails at dependency installation too. Their actual logs
show both signed archive attempts ending after210 seconds, with package-index
downloads still progressing. One second-archive15MB universe index takes about
180 seconds by itself. Missing screenshot preservation is a secondary failure
because the browser group never ran. Other jobs remain live at this checkpoint;
this is not a terminal summary for the whole main run.

The browser dependency installation attempt now has a480-second total deadline
per official archive instead of210. Exactly two archives remain, with original
signed source/keyring, strict update-error mode, zero transport retries and
20-second transport/30-second lock limits. Playwright still chooses the complete
Chromium and WebKit dependency list; no package or browser is omitted. Failure
reports the actual exit code and deadline. Exhaustion still fails the workflow.
All four affected installer steps use18 minutes to accommodate two bounded
attempts plus browser-download/probe overhead. At that first checkpoint, test
execution timeouts and whole-job limits were unchanged. The later enclosing-job
correction below supersedes that budget statement. This does not guarantee
external availability.

Local isolated Linux control-flow check passes onea639a25 with unchanged tracked
source: `.local/ci-browser-deps-timeout97c/result.json`. The actual script runs
with mock sudo/timeout/node commands, checking signed sources, strict APT config,
both browser engines, first success, timeout/mirror fallback, exhausted timeouts
and non-timeout command failures. It makes no network/package changes and is now
run before real browser installation in all three workflow files. Real hosted
download/build/browser acceptance remains necessary on a fresh candidate.

Failure excerpts are preserved at `.local/design-publication/design97c-income-statement-deps-failure.log`,
`design97c-commercial-deps-failure.log` and the auxiliary excerpt recorded with
the publication checkpoint. No current acceptance or artifact is transferred.

## Enclosing job budget correction after public98b

All three98b workflows are terminal. Main45160039723 has19 successful jobs,
two cancelled browser jobs and one failed Foundation prerequisite guard.
Owner expense45160039767 passes. Commercial45160039720 has two successful
jobs and one cancelled commercial job. Required Linux database recovery step28
passes in137642783456, whose whole job also passes; later Foundation build and
application-image/worker acceptance are not established.

Schedule137642783702 and records137642784037 start10:52:40UTC and are
cancelled at11:27:53, matching their35-minute enclosing job limit. Their
dependency installs succeed after about16 minutes; browser execution starts
11:10:26. The original35-minute test allowance no longer fits after the longer
bounded install. Successful cases continue before cancellation. Auxiliary
commercial137642783304 is likewise cancelled at11:17:53, matching its25-minute
job limit while browser cases still progress. Inspected logs show cancellation,
not an application assertion failure; no pass is claimed for interrupted suites.

Main browser job limits are now53 minutes, with an explicit35-minute test-step
limit. Auxiliary commercial's enclosing job is43 minutes, with an explicit
25-minute commercial test-step limit. This reserves the bounded18-minute
dependency-install allowance while preserving the original execution allowances.
Individual case limits, matrices, engines, assertions and prerequisite gates are
unchanged. Foundation and owner-expense job limits are unchanged. Fresh hosted
acceptance must verify the correction; local workflow inspection is not a hosted
pass. This changes execution budgeting only, not dependency trust or app behavior.
