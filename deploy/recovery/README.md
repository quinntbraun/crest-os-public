# Recovery host package — inactive review templates

This is a deployment option for an owner-selected Linux host with local rootless
Podman, cgroups v2 and a systemd user manager. It does not select/provision a
host, install packages, change users/groups, grant Docker access, configure
accounts, copy credentials or enable a service/timer. The web application never
receives recovery credentials. Windows Docker Desktop rehearsal does not prove
this Linux/Podman host configuration.

The launcher runs the isolated recovery-tool image, not host Node or a database
server. It refuses root, nonprivate paths, missing explicit staging authorization,
mutable image names, unrecognized local image identity and remote/rootful
Podman. There is no pull, restart policy, port publishing, socket mount, automatic
cleanup of earlier journals or replacement of an existing named container.
The private profile remains data; no file is sourced/evaluated as shell.

The optional status argument runs read-only capture diagnostics in the pinned
image with network none and config/state mounts read-only. It needs no staging
authorization, work directory or release mount, and never starts a capture.
It reports failures, review-required candidates and unfinished/uncertain starts;
it does not report complete-point protection or healthy backup success. The
diagnostic result exits2, read failure exits1. See
[capture status](../../planning/RECOVERY_CAPTURE_STATUS.md).

## Required host layout

All directories below belong to the service's host user, mode0700. Private files
are regular nonsymlink files, mode0600. Keep the emergency kit and private age
identity outside every mounted directory. Never put actual profiles in Git.

| Host location under the service user's home | Container path / contents |
|---|---|
| .config/crest-recovery | /recovery/config, read-only; profile.json, explicit database CA, release-bound configuration recipe, image.id and staging authorization |
| .local/state/crest-recovery | /recovery/state, persistent writable claims and artifact/command journals |
| .local/share/crest-recovery/work | /recovery/work, private writable encrypted capture workspace |
| .local/share/crest-recovery/release | /recovery/release, read-only matching build-manifest.json, crest-os-source.tar and crest-os-image.tar |
| .local/libexec/crest-recovery/run-capture.sh | Host launcher copied from this package, owner-only executable |

The exact private schemaVersion1 profile is documented in
[RECOVERY_CAPTURE_COMMAND.md](../../planning/RECOVERY_CAPTURE_COMMAND.md). Set
stateDirectory=/recovery/state, workspaceDirectory=/recovery/work and all
configuration/distribution paths to their corresponding absolute container paths.
Use tools.pgDump=/opt/crest-postgres/bin/pg_dump and tools.age=/opt/crest-age/age.
Supply only verified least-authority database/source/vault/monitor credentials
and the public encryption recipient. The TLS CA, release/recipe bindings and
current registry remain verified by the existing capture command.

image.id is exactly one newline-terminated sha256:<64 lowercase hex> identifier
for the locally imported, inspected recovery image. Record the actual image ID
reported by this host's Podman after independently checking the transferred
image archive hash; an OCI index digest from a different engine may differ from
its local image/config ID. Do not copy an example digest or select a mutable tag.
The launcher compares the inspected local ID again and uses pulls disabled.

## Host review and activation boundary

First rehearse rootless UID mapping, read-only source/config access, persistent
private0700/0600 ownership and directory fsync, compatible native tools, actual
verified TLS, restricted provider keys/Object Lock, available private disk,
cgroup limits, container termination and uncertainty/no-replay behavior on this
host. The768MiB process/64MiB temporary limits are bounded starting settings,
not measured production capacity. The persistent work directory holds capture
artifacts; it is not the temporary memory mount. Validate SELinux labels where
applicable; do not disable host labeling or silently relabel unrelated paths.
No automatic fallback weakens a host requirement.

Inspect the .example unit files, then validate copies with this host's
systemd-analyze verify and systemd-analyze calendar using the UTC expression.
These templates have not been validated against an actual selected host's
systemd/Podman runtime. Do not enable them as production backups while final
complete-point/catalog, retention/status/independent alerts, external recovery
kit and independent-host restore gates remain open.

An explicitly authorized candidate-only staging rehearsal can use a private
capture-staging-authorized file containing CANDIDATE_ONLY. This is a deliberate
operator staging switch, not evidence that any external acceptance gate passed.
The copied service/timer are disabled by default. Owner-reviewed host startup/
user-manager persistence is still required for reliable unattended scheduling;
no linger or boot setting is changed by this package.

Candidate capture exits2 and therefore remains failed/review-required in systemd;
do not remap it to success or send a successful-backup heartbeat. Exit1 is a
closed failure. Both require review. A persistent timer catches up only the
latest canonical slot; the durable dispatcher never replays a completed, failed,
torn or uncertain claim and never calls a missed interval protected. Inspect
existing journal/claim records before any recovery action. Do not delete them
to make a slot run again. Later slots have distinct identities; final success
publication and independent missed-success alerts are still separate work.

The unit has no automatic restart. A fixed existing container name refuses
instead of being replaced. Investigate any leftover container by its actual
identity and retained journals; this package does not prune or force-remove it.

Contracts: [Podman run](https://docs.podman.io/en/latest/markdown/podman-run.1.html),
[systemd service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
and [systemd timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).
