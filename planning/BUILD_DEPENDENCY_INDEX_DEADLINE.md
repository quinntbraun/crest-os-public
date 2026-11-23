# Hosted build dependency index deadline

Public96e main45145555224 finishes21/22 jobs successfully; both ancillary
suites pass. Final Foundation137611835245 fails at step10, installing Ubuntu
build dependencies, before its later lint/unit/build/browser/container/worker
gates. Missing service screenshots cause a secondary preservation failure
because those later steps never ran. This is not full release acceptance.

The log shows both signed archive attempts exhausting the existing120-second
update window. The15MB universe index alone takes about95 seconds on the second
archive; main/update/security/backport package indexes are still downloading at
the cutoff. There is no reported signature, package-resolution or application
test error in this step. The exact step log and terminal evidence are retained
in `.local/design-publication/design96e-apt-failure.log` and
`.local/design-publication/design96e-terminal-summary.json`.

The index update limit is now300 seconds per selected official archive. Package
installation retains its180-second limit; transport timeouts, two fixed mirrors,
all original suites/components/package requirements, signed keyring and
--error-on=any remain unchanged. Failures identify whether update or installation
failed and report exit status/deadline. Exhausted attempts still fail the build.

The fast regression harness exercises the real installer with mock dpkg/sudo/
timeout commands: an already-installed no-op; first-index timeout followed by
successful signed-mirror fallback; exhaustion of both updates; and failed package
installation on both mirrors. It performs no network or package changes and
checks that the signed source, strict update and complete package list remain
in each command. The existing actual Ubuntu index-target comparison remains
unchanged. A new hosted candidate must confirm the real download/build path;
this local harness does not establish external archive availability.

Local isolated Linux control-flow verification passes on8dca5e10; tracked source is unchanged before/after. Proof: .local/ci-build-deps-timeout96e/result.json. This confirms all four mock scenarios only; real hosted download/build acceptance remains required.
