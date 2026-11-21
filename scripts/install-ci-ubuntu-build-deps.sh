#!/usr/bin/env bash
set -euo pipefail

packages=(cmake g++ make pkg-config libjpeg-dev zlib1g-dev libpng-dev libx265-dev)
all_installed=true
for package in "${packages[@]}"; do
  if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" != 'install ok installed' ]]; then
    all_installed=false
    break
  fi
done
if "$all_installed"; then
  exit 0
fi

runner_sources=/etc/apt/sources.list.d/ubuntu.sources
test -r "$runner_sources"
grep -qFx 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' "$runner_sources"
mirror_uri='URIs: mirror+file:/etc/apt/apt-mirrors.txt'
grep -qFx "$mirror_uri" "$runner_sources"

# Use only the runner's signed Ubuntu suites and components. Avoid apt's
# unbounded mirror traversal by choosing one direct archive per attempt.
source_directory=$(mktemp -d /tmp/crest-build-ubuntu.XXXXXXXX)
sources="$source_directory/ubuntu.sources"
trap 'rm -f -- "$sources"; rmdir -- "$source_directory"' EXIT
chmod 755 "$source_directory"
touch "$sources"
chmod 644 "$sources"
for archive in https://archive.ubuntu.com/ubuntu https://us.archive.ubuntu.com/ubuntu; do
  bash scripts/ci-ubuntu-package-sources.sh "$runner_sources" "$archive" > "$sources"
  if grep -q 'mirror+file:' "$sources"; then
    echo 'Unresolved Ubuntu archive mirror' >&2
    exit 1
  fi
  apt_options=(-o "Dir::Etc::SourceList=$sources" -o 'Dir::Etc::SourceParts=-'
    -o 'Acquire::Retries=0' -o 'Acquire::http::Timeout=20' -o 'Acquire::https::Timeout=20'
    -o 'DPkg::Lock::Timeout=30')
  if sudo timeout --kill-after=10s 120s apt-get "${apt_options[@]}" --error-on=any update &&
    sudo timeout --kill-after=10s 180s apt-get "${apt_options[@]}" install --yes --no-install-recommends "${packages[@]}"; then
    exit 0
  fi
  echo "Ubuntu build dependencies could not be installed from $archive" >&2
done
exit 1
