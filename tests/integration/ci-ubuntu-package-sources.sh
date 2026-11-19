#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

runner_sources=/etc/apt/sources.list.d/ubuntu.sources
directory=$(mktemp -d /tmp/crest-apt-target-test.XXXXXXXX)
input="$directory/runner.sources"
original="$directory/original.sources"
baseline="$directory/baseline.sources"
optimized="$directory/optimized.sources"
stripped="$directory/stripped.sources"
baseline_targets="$directory/baseline-targets.txt"
optimized_targets="$directory/optimized-targets.txt"
packages="$directory/packages.txt"
unsigned="$directory/unsigned.sources"
preconfigured="$directory/preconfigured.sources"
trap 'rm -f -- "$input" "$original" "$baseline" "$optimized" "$stripped" "$baseline_targets" "$optimized_targets" "$packages" "$unsigned" "$preconfigured"; rmdir -- "$directory"' EXIT
cp "$runner_sources" "$original"
sed -E 's|^URIs: .*|URIs: mirror+file:/etc/apt/apt-mirrors.txt|' "$runner_sources" > "$input"
format='$(IDENTIFIER)|$(SITE)|$(RELEASE)|$(COMPONENT)|$(ARCHITECTURE)'
for archive in https://archive.ubuntu.com/ubuntu https://us.archive.ubuntu.com/ubuntu; do
  bash scripts/ci-ubuntu-package-sources.sh "$input" "$archive" > "$optimized"
  sed "s|^URIs: mirror+file:/etc/apt/apt-mirrors.txt$|URIs: $archive|" "$input" > "$baseline"
  sed '/^Targets: Packages$/d' "$optimized" > "$stripped"
  cmp "$baseline" "$stripped"
  apt-get indextargets --no-release-info -o "Dir::Etc::SourceList=$baseline" -o 'Dir::Etc::SourceParts=-' -o Acquire::Languages=en --format "$format" | sort > "$baseline_targets"
  apt-get indextargets --no-release-info -o "Dir::Etc::SourceList=$optimized" -o 'Dir::Etc::SourceParts=-' -o Acquire::Languages=en --format "$format" | sort > "$optimized_targets"
  grep '^Packages|' "$baseline_targets" > "$packages"
  cmp "$packages" "$optimized_targets"
  grep -q '^Translations|' "$baseline_targets"
done
if bash scripts/ci-ubuntu-package-sources.sh "$input" https://unapproved.example/ubuntu > /dev/null 2>&1; then exit 1; fi
sed '/^Signed-By:/d' "$input" > "$unsigned"
if bash scripts/ci-ubuntu-package-sources.sh "$unsigned" https://archive.ubuntu.com/ubuntu > /dev/null 2>&1; then exit 1; fi
sed '/^Types: /a Targets: Packages' "$input" > "$preconfigured"
if bash scripts/ci-ubuntu-package-sources.sh "$preconfigured" https://archive.ubuntu.com/ubuntu > /dev/null 2>&1; then exit 1; fi
cmp "$runner_sources" "$original"
printf 'Ubuntu APT targets verified for both archives: all package indexes retained, optional metadata omitted, signed source and input guards unchanged.\n'
