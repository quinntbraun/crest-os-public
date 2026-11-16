#!/usr/bin/env bash
set -euo pipefail

runner_sources=/etc/apt/sources.list.d/ubuntu.sources
mirror_uri='URIs: mirror+file:/etc/apt/apt-mirrors.txt'
grep -qFx 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' "$runner_sources"
grep -qFx "$mirror_uri" "$runner_sources"

node_bin=$(command -v node)
playwright_cli=$(realpath node_modules/playwright/cli.js)
test -x "$node_bin"
test -f "$playwright_cli"

# Playwright chooses the browser libraries. Give its APT subprocesses the
# runner's signed repositories, with one direct archive per bounded attempt.
directory=$(mktemp -d /tmp/crest-browser-ubuntu.XXXXXXXX)
sources="$directory/ubuntu.sources"
config="$directory/apt.conf"
trap 'rm -f -- "$sources" "$config"; rmdir -- "$directory"' EXIT
chmod 755 "$directory"
cat > "$config" <<EOF
Dir::Etc::SourceList "$sources";
Dir::Etc::SourceParts "-";
APT::Update::Error-Mode "any";
Acquire::Retries "0";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
DPkg::Lock::Timeout "30";
EOF
chmod 644 "$config"
for archive in https://archive.ubuntu.com/ubuntu https://us.archive.ubuntu.com/ubuntu; do
  sed "s|^$mirror_uri$|URIs: $archive|" "$runner_sources" > "$sources"
  chmod 644 "$sources"
  if grep -q 'mirror+file:' "$sources"; then
    echo 'Unresolved Ubuntu archive mirror' >&2
    exit 1
  fi
  if sudo timeout --kill-after=10s 210s env APT_CONFIG="$config" \
    "$node_bin" "$playwright_cli" install-deps chromium webkit; then
    exit 0
  fi
  echo "Browser dependencies could not be installed from $archive" >&2
done
exit 1
