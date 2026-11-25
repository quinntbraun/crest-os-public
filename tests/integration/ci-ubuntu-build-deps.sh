#!/usr/bin/env bash
set -euo pipefail

# Exercise real installer control flow and signed-source preparation, without
# root, network, package installation or waiting for an actual timeout.
directory=$(mktemp -d /tmp/crest-build-deps-test.XXXXXXXX)
case "$directory" in /tmp/crest-build-deps-test.*) ;; *) exit 1 ;; esac
trap 'rm -rf -- "$directory"' EXIT
mkdir "$directory/bin"
cat > "$directory/bin/dpkg-query" <<'EOF'
#!/usr/bin/env bash
if [[ "$CREST_MOCK_MODE" == installed ]]; then printf 'install ok installed'; else exit 1; fi
EOF
cat > "$directory/bin/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
cat > "$directory/bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == --kill-after=10s ]]
duration=$2
shift 2
[[ "$1" == apt-get ]]
stage=install
sources=
for argument in "$@"; do
  [[ "$argument" != update ]] || stage=update
  case "$argument" in Dir::Etc::SourceList=*) sources=${argument#Dir::Etc::SourceList=} ;; esac
done
test -f "$sources"
grep -qFx 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' "$sources"
grep -qFx 'Targets: Packages' "$sources"
if grep -q 'mirror+file:' "$sources"; then exit 99; fi
archive=$(sed -n 's/^URIs: //p' "$sources" | head -n 1)
case "$archive" in https://archive.ubuntu.com/ubuntu|https://us.archive.ubuntu.com/ubuntu) ;; *) exit 99 ;; esac
[[ " $* " == *' Acquire::Retries=0 '* ]]
[[ " $* " != *allow-unauthenticated* ]]
if [[ "$stage" == update ]]; then
  [[ "$duration" == 300s ]]
  [[ " $* " == *' --error-on=any update '* ]]
else
  [[ "$duration" == 180s ]]
  [[ " $* " == *' install --yes --no-install-recommends cmake g++ make pkg-config libjpeg-dev zlib1g-dev libpng-dev libx265-dev '* ]]
fi
printf '%s|%s|%s\n' "$stage" "$duration" "$archive" >> "$CREST_MOCK_LOG"
case "$CREST_MOCK_MODE:$stage:$archive" in
  first_timeout:update:https://archive.ubuntu.com/ubuntu|all_timeouts:update:*) exit 124 ;;
  install_failures:install:*) exit 100 ;;
esac
EOF
chmod 700 "$directory/bin/"*
original_path=$PATH
for mode in installed first_timeout all_timeouts install_failures; do
  log="$directory/$mode.log"
  output="$directory/$mode.output"
  touch "$log"
  status=0
  CREST_MOCK_MODE="$mode" CREST_MOCK_LOG="$log" PATH="$directory/bin:$original_path" bash scripts/install-ci-ubuntu-build-deps.sh > "$output" 2>&1 || status=$?
  case "$mode" in
    installed) [[ "$status" == 0 ]]; test ! -s "$log" ;;
    first_timeout)
      [[ "$status" == 0 ]]
      printf '%s\n' 'update|300s|https://archive.ubuntu.com/ubuntu' 'update|300s|https://us.archive.ubuntu.com/ubuntu' 'install|180s|https://us.archive.ubuntu.com/ubuntu' > "$directory/expected"
      cmp "$log" "$directory/expected"
      grep -qF 'exit 124; deadline 300s' "$output"
      ;;
    all_timeouts) [[ "$status" == 1 ]]; [[ "$(wc -l < "$log")" == 2 ]]; test "$(grep -cF 'exit 124; deadline 300s' "$output")" == 2 ;;
    install_failures) [[ "$status" == 1 ]]; [[ "$(wc -l < "$log")" == 4 ]]; test "$(grep -cF 'exit 100; deadline 180s' "$output")" == 2 ;;
  esac
done
printf 'Build dependency installer: installed/no-op, timeout fallback, exhausted indexes and failed installs verified; signed sources and package requirements preserved.\n'
