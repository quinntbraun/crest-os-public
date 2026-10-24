# Delivery workflow

2026-10-24. Owner requested faster delivery without reducing quality or the approved V1 scope. This execution decision does not amend canonical business or release requirements.

Keep Next.js/React, TypeScript and PostgreSQL. The repository already implements their authentication, transaction, tenant and build boundaries. No measured framework defect currently justifies paying the rewrite and regression cost. Reconsider only for a demonstrated product blocker, with a concrete migration comparison.

The observed bottleneck is serial validation and many small release cycles. The recent PR47-56 workflow records span about316 minutes of run intervals across30 completed runs (21 success,8 failure,1 cancelled). Some coding overlaps those intervals; they are not a measurement of idle time or active coding. Do not derive a delivery schedule from them.

## Implemented verification change

Run three independent groups on separate standard Ubuntu24.04 runners, each with its own digest-pinned disposable PostgreSQL cluster: foundation/commands, provider/evidence, and genuine authentication. Suites inside a group stay serial because fixtures own cluster-wide roles. Every pre-existing command remains mandatory on pull requests and main; no path filter, reduced suite, permissive error handling or new service credential is introduced.

The existing required `Foundation checks` job retains its name and normal protected-merge status. It uses `always()` and an explicit fail-closed prerequisite guard: failure, cancellation, skipping, absent/malformed results or an unexpected dependency set cannot pass. Only then run the unchanged provenance/secret/dependency/lint/type/unit/build/browser/container gates and publish the same two short-lived source-bound artifacts. Ordinary Ubuntu runners are free for this public repository; no larger paid runner is used. Keep actual timing in the PR evidence; runner queues/downloads vary, so do not promise a fixed speedup.

GitHub references: [job dependencies and always](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs), [standard public runners](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).

## Product delivery

Follow [usable release milestones](USABLE_RELEASE_MILESTONES.md): actual synthetic backup/isolated restore and basic private files, then the first customer/vehicle workflow. Bundle schema, business logic, UI, affected exports and meaningful regression tests into coherent feature-sized PRs. Do not create a release cycle for each small assertion or add speculative foundation refinements. A blocker needs an actual requirement/defect and a finite acceptance criterion.

Keep continuation notes short and current; Git/PR history holds historical detail. Report user-visible milestones and remaining acceptance gaps. Test counts, PR counts and CI optimization are not extra CRM functionality or percentage completion. Owner setup is required only when a necessary account/consent/real-device gate is actually reached; continue free synthetic implementation meanwhile.
