#!/bin/sh
# Local Linux/rootless Podman launcher only. It provisions nothing and never
# interprets a private profile as shell code. Container exit2 remains a failure.
set -eu
umask 077
refuse() { echo 'RECOVERY_HOST_REVIEW_REQUIRED' >&2; exit 1; }
[ "$#" -le 1 ] || refuse
mode=${1:-capture}
case "$mode" in capture|status) ;; *) refuse ;; esac
[ "$(uname -s)" = Linux ] || refuse
owner_uid=$(id -u)
owner_gid=$(id -g)
[ "$owner_uid" -ne 0 ] || refuse
case "${HOME:-}" in /*) ;; *) refuse ;; esac
case "$HOME" in *:*|*,*|*'
'*) refuse ;; esac
config="$HOME/.config/crest-recovery"
state="$HOME/.local/state/crest-recovery"
work="$HOME/.local/share/crest-recovery/work"
release="$HOME/.local/share/crest-recovery/release"
for directory in "$config" "$state"; do
  [ -d "$directory" ] && [ ! -L "$directory" ] || refuse
  [ "$(stat -c '%u %a' "$directory")" = "$owner_uid 700" ] || refuse
done
for file in "$config/profile.json" "$config/image.id"; do
  [ -f "$file" ] && [ ! -L "$file" ] || refuse
  [ "$(stat -c '%u %a' "$file")" = "$owner_uid 600" ] || refuse
done
[ "$(wc -c < "$config/image.id")" -eq 72 ] || refuse
IFS= read -r image < "$config/image.id" || refuse
printf '%s\n' "$image" | grep -Eq '^sha256:[a-f0-9]{64}$' || refuse
image_hash=${image#sha256:}
# Local rootless mode only; never fall back to a remote or privileged daemon.
[ -x /usr/bin/podman ] && [ -r /sys/fs/cgroup/cgroup.controllers ] || refuse
[ "$(/usr/bin/podman --remote=false info --format '{{.Host.Security.Rootless}}' 2>/dev/null)" = true ] || refuse
observed=$(/usr/bin/podman --remote=false image inspect --format '{{.Id}}' "$image_hash" 2>/dev/null) || refuse
[ "${observed#sha256:}" = "$image_hash" ] || refuse
if [ "$mode" = status ]; then
  # No staging authorization, network, work/release mount or writable journal
  # is needed to inspect existing capture metadata. This cannot start a backup.
  exec /usr/bin/podman --remote=false run \
    --name crest-recovery-status --rm --pull=never --restart=no \
    --read-only --read-only-tmpfs=false --cap-drop=ALL \
    --security-opt=no-new-privileges --userns=keep-id \
    --user "$owner_uid:$owner_gid" --network=none \
    --memory=256m --pids-limit=64 --entrypoint=node \
    --volume "$config:/recovery/config:ro,nosuid,nodev,noexec" \
    --volume "$state:/recovery/state:ro,nosuid,nodev,noexec" \
    "$image_hash" --conditions=react-server scripts/recovery-capture-status.mjs /recovery/config/profile.json
fi
for directory in "$work" "$release"; do
  [ -d "$directory" ] && [ ! -L "$directory" ] || refuse
  [ "$(stat -c '%u %a' "$directory")" = "$owner_uid 700" ] || refuse
done
authorization="$config/capture-staging-authorized"
[ -f "$authorization" ] && [ ! -L "$authorization" ] || refuse
[ "$(stat -c '%u %a' "$authorization")" = "$owner_uid 600" ] || refuse
[ "$(cat "$authorization")" = CANDIDATE_ONLY ] || refuse
exec /usr/bin/podman --remote=false run \
  --name crest-recovery-capture --rm --pull=never --restart=no \
  --read-only --read-only-tmpfs=false --cap-drop=ALL \
  --security-opt=no-new-privileges --userns=keep-id \
  --user "$owner_uid:$owner_gid" --network=private \
  --memory=768m --pids-limit=128 --stop-timeout=60 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
  --volume "$config:/recovery/config:ro,nosuid,nodev,noexec" \
  --volume "$release:/recovery/release:ro,nosuid,nodev,noexec" \
  --volume "$state:/recovery/state:rw,nosuid,nodev,noexec" \
  --volume "$work:/recovery/work:rw,nosuid,nodev,noexec" \
  "$image_hash" /recovery/config/profile.json
