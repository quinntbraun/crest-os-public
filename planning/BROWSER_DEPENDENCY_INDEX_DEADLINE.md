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
attempts plus browser-download/probe overhead. Test execution timeouts and
whole-job limits are unchanged. This does not guarantee external availability.

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
