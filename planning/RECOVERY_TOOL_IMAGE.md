# Isolated recovery-tool image

Dockerfile.recovery packages the existing Linux recovery commands separately
from the web application. This implements the image boundary required by
EXPORTS_AND_BACKUPS section4; it does not enable production services or declare
a complete backup. No account, host or credential is provisioned.

Both base images are immutable digest pins already adopted in toolchain.json:
Node24.22.0 and Supabase PostgreSQL17.11. The extraction stage copies only
pg_dump, pg_restore, psql and their actual transitive ELF library files, preserving
the pinned Nix absolute interpreter/RPATH layout. It uses that glibc interpreter
to discover libraries, rather than Alpine's incompatible ldd. No database server,
extensions, Nix daemon, database data or credential is copied. The age1.3.2
archive is downloaded by the existing SHA-256/version-verifying installer.
Production JavaScript dependencies come from npm ci with the committed lockfile
and install scripts disabled. No new dependency or package-manager authority.

The dedicated Dockerfile.recovery.dockerignore permits only source, lockfile,
public toolchain/registry and the selected commands/installers. Local profiles,
archives, keys, data and development node_modules never enter the build context.
Final source/tools are root-owned, the process defaults to unprivileged node,
and there is no port or web healthcheck. Builds verify tool versions, current
schema138 registry hash and imports of the actual command implementations.

Build with docker build --file Dockerfile.recovery --iidfile <private-output>
--tag <local-review-tag> . and inspect the resulting immutable image ID.
Deploy only the inspected ID/digest with pulls disabled, read-only root,
all capabilities dropped, no-new-privileges, an unprivileged owner UID and
explicit bounded scratch/state/config mounts. Never mount a container socket.
Backup capture needs explicitly restricted outbound database/store/vault/monitor
access; offline verification should use network none. Host UID mapping and
private0700 directories/0600 profile ownership must match the running UID.

The capture profile uses /opt/crest-postgres/bin/pg_dump and /opt/crest-age/age.
The default entrypoint dispatches the current UTC slot, taking only an absolute
private profile path. Explicit capture, owner-kit and operator export remain
separate node --conditions=react-server scripts/... invocations through an
explicit node entrypoint override. No private decryption key belongs in the
scheduled capture container; owner-kit restore is a separate offline operation.

Actual image build passes on2de7a60: immutable local image
sha256:a8e21cb993a5200d82731bc1bb91d91e7bb68e44bb5851d1de3f47e11ed2f9b0,
.local/recovery-tool-image-build-current/result.json, source stable. The focused
actual image rehearsal passes1/1 on ca9c111: rootless process, read-only root,
capabilities dropped, internal-only network, native pg_dump/age/pg_restore/psql,
exact bigint/decimal/Unicode/binary values, preserved CHECK constraint and closed
missing-profile dispatch. Owned containers/network removed and tracked source
unchanged: .local/recovery-tool-image-native-ready/result.json. The original
image rehearsal also passed; the first rebuilt-image rehearsal failed with an
opaque stage. Preserve .local/recovery-tool-image-native-current/result.json;
later success with explicit network readiness/closed failure stages does not
prove the original cause. Both initial packaging build failures remain retained:
missing compatibility metadata and untrusted archive tool ownership were
corrected without weakening the executable guard.

Scheduler14 cases pass on ac55c1d in pinned network-disabled Linux,
including real private filesystem/fsync/journal/controller with controlled
producer/PG/SDK/HTTP ports. This is not real provider/TLS/image acceptance.
Final complete-point publication, retention, status/alerts, backup_runs,
independent-host recovery, offline custody and production activation remain open.
