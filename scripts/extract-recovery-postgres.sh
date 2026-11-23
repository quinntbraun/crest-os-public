#!/bin/sh
set -eu

# This interpreter path belongs to the immutable PostgreSQL image in
# Dockerfile.recovery. Preserve its absolute ELF interpreter/RPATH layout;
# the Alpine host's ldd cannot resolve these glibc executables correctly.
loader=/nix/store/j193mfi0f921y0kfs8vjc1znnr45ispv-glibc-2.40-66/lib/ld-linux-x86-64.so.2
mkdir -p /recovery-postgres/bin /recovery-postgres/nix/store
copy_file() {
  case "$1" in /nix/store/*) ;; *) exit 1 ;; esac
  test -f "$1"
  mkdir -p "/recovery-postgres$(dirname "$1")"
  cp -L "$1" "/recovery-postgres$1"
}
for tool in pg_dump pg_restore psql; do
  binary=$(readlink -f "/nix/var/nix/profiles/default/bin/$tool")
  test "$("$binary" --version)" = "$tool (PostgreSQL) 17.11"
  copy_file "$binary"
  copy_file "$loader"
  # --list reports transitive dependencies using the binary's actual loader.
  "$loader" --list "$binary" > /tmp/recovery-libraries
  awk '{ for (i=1; i<=NF; i++) if ($i ~ /^\/nix\/store\//) print $i }' /tmp/recovery-libraries > /tmp/recovery-paths
  while IFS= read -r library; do copy_file "$library"; done < /tmp/recovery-paths
  cp -L "$binary" "/recovery-postgres/bin/$tool"
done
