#!/usr/bin/env bash
set -euo pipefail

mirror_list=/etc/apt/apt-mirrors.txt
test -s "$mirror_list"
grep -qF "mirror+file:$mirror_list" /etc/apt/sources.list.d/ubuntu.sources

# GitHub runner Ubuntu archive DNS has failed across multiple jobs.
# Prefer the official MIT mirror while retaining the runner fallbacks
# and the Ubuntu archive keyring configured in ubuntu.sources.
mit_mirror=https://mirrors.mit.edu/ubuntu/
if ! grep -qF "$mit_mirror" "$mirror_list"; then
  printf '%s\tpriority:0\n' "$mit_mirror" | sudo tee -a "$mirror_list" > /dev/null
fi
printf '%s\n' 'Acquire::Retries "1";' 'Acquire::http::Timeout "15";' 'Acquire::https::Timeout "15";' | sudo tee /etc/apt/apt.conf.d/zz-crest-ci-downloads > /dev/null
