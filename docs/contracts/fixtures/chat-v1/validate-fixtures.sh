#!/usr/bin/env bash
set -euo pipefail

draft_dir="$(cd "$(dirname "$0")" && pwd)"
fixture_dir="$draft_dir"

for fixture in "$fixture_dir"/*.json; do
  jq -e . "$fixture" >/dev/null
done

node "$draft_dir/contract-fixture-validator.mjs"

if test -x /sbin/sha256sum; then
  (cd "$fixture_dir" && /sbin/sha256sum -c checksums.txt >/dev/null)
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$fixture_dir" && sha256sum -c checksums.txt >/dev/null)
else
  (cd "$fixture_dir" && LC_ALL=C LANG=C shasum -a 256 -c checksums.txt >/dev/null)
fi

printf '%s\n' 'CHAT-000 time_fit application-diff fixtures validated.'
