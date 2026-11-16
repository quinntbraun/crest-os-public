#!/usr/bin/env bash
set -euo pipefail

npx --no-install playwright install chromium webkit
if ! node scripts/probe-ci-browsers.mjs; then
  bash scripts/prepare-ci-ubuntu-apt.sh
  node scripts/probe-ci-browsers.mjs
fi
