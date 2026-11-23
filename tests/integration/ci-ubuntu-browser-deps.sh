#!/usr/bin/env bash
set -euo pipefail
# Real installer, simulated subprocess outcomes; no network or package writes.
directory=$(mktemp -d /tmp/crest-browser-deps-test.XXXXXXXX)
case "$directory" in /tmp/crest-browser-deps-test.*) ;; *) exit 1 ;; esac
trap 'rm -rf -- "$directory"' EXIT
mkdir "$directory/bin"
cat > "$directory/bin/node" <<'EOF'
#!/usr/bin/env bash
exit 99
EOF
cat > "$directory/bin/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
cat > "$directory/bin/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == --kill-after=10s && "$2" == 480s && "$3" == env ]]
[[ "$4" == APT_CONFIG=* ]]
config=${4#APT_CONFIG=}
test -f "$config"
grep -qFx 'APT::Update::Error-Mode "any";' "$config"
grep -qFx 'Acquire::Retries "0";' "$config"
grep -qFx 'Acquire::https::Timeout "20";' "$config"
grep -qFx 'DPkg::Lock::Timeout "30";' "$config"
sources=$(sed -n 's/^Dir::Etc::SourceList "\(.*\)";$/\1/p' "$config")
test -f "$sources"
grep -qFx 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' "$sources"
grep -qFx 'Targets: Packages' "$sources"
if grep -q 'mirror+file:' "$sources"; then exit 99; fi
archive=$(sed -n 's/^URIs: //p' "$sources" | head -n 1)
case "$archive" in https://archive.ubuntu.com/ubuntu|https://us.archive.ubuntu.com/ubuntu) ;; *) exit 99 ;; esac
[[ "$5" == */bin/node && "$6" == */node_modules/playwright/cli.js ]]
[[ "$7" == install-deps && "$8" == chromium && "$9" == webkit && "$#" == 9 ]]
printf '%s\n' "$archive" >> "$CREST_MOCK_LOG"
case "$CREST_MOCK_MODE:$archive" in
 first_timeout:https://archive.ubuntu.com/ubuntu|all_timeouts:*) exit 124 ;;
 command_failures:*) exit 100 ;;
esac
EOF
chmod 700 "$directory/bin/"*
original_path=$PATH
for mode in first_success first_timeout all_timeouts command_failures; do
 log="$directory/$mode.log"
 output="$directory/$mode.output"
 touch "$log"
 status=0
 CREST_MOCK_MODE="$mode" CREST_MOCK_LOG="$log" PATH="$directory/bin:$original_path" bash scripts/prepare-ci-ubuntu-apt.sh > "$output" 2>&1 || status=$?
 case "$mode" in
  first_success) [[ "$status" == 0 ]]; [[ "$(wc -l < "$log")" == 1 ]] ;;
  first_timeout)
   [[ "$status" == 0 ]]
   printf '%s\n' 'https://archive.ubuntu.com/ubuntu' 'https://us.archive.ubuntu.com/ubuntu' > "$directory/expected"
   cmp "$log" "$directory/expected"
   grep -qF 'exit 124; deadline 480s' "$output"
   ;;
  all_timeouts) [[ "$status" == 1 ]]; [[ "$(wc -l < "$log")" == 2 ]]; [[ "$(grep -cF 'exit 124; deadline 480s' "$output")" == 2 ]] ;;
  command_failures) [[ "$status" == 1 ]]; [[ "$(wc -l < "$log")" == 2 ]]; [[ "$(grep -cF 'exit 100; deadline 480s' "$output")" == 2 ]] ;;
 esac
done
printf 'Browser dependencies: success, timeout fallback, exhausted timeouts and command failures verified with signed sources and both browser engines.\n'
