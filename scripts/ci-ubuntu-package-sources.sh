#!/usr/bin/env bash
set -euo pipefail

test "$#" -eq 2
runner_sources=$1
archive=$2
case "$archive" in
  https://archive.ubuntu.com/ubuntu|https://us.archive.ubuntu.com/ubuntu) ;;
  *) echo 'Unexpected Ubuntu archive' >&2; exit 1 ;;
esac
mirror_uri='URIs: mirror+file:/etc/apt/apt-mirrors.txt'
grep -qFx 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' "$runner_sources"
grep -qFx "$mirror_uri" "$runner_sources"
if grep -q '^Targets:' "$runner_sources"; then
  echo 'Unexpected preconfigured Ubuntu index targets' >&2
  exit 1
fi
# Keep every original suite/component and signed package index. Translation and
# command-not-found indexes do not resolve or authenticate browser/build packages.
sed -e "s|^$mirror_uri$|URIs: $archive|" -e '/^Types: /a Targets: Packages' "$runner_sources"
