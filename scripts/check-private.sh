#!/bin/sh
# Refuses to let personal data into git. Runs as a pre-commit hook
# (installed by `make hooks`) and on demand with `make check-private`.
#
# It collects every value from config.local.json (usernames, league ids,
# cookies, TV address) plus any extra words listed one per line in
# .private/words.txt (team names, league names), then scans what is staged
# (or with --all, every tracked file) for them.
set -eu
cd "$(git rev-parse --show-toplevel)"

words=$(mktemp)
trap 'rm -f "$words"' EXIT
if [ -f config.local.json ]; then
  jq -r '.. | scalars | tostring' config.local.json \
    | grep -vxE 'true|false|null|right|left|[0-9.]{1,5}' | grep -v '^$' >> "$words" || true
fi
[ -f .private/words.txt ] && grep -v '^\s*$' .private/words.txt >> "$words"
[ -s "$words" ] || { echo "check-private: nothing to check (no config.local.json)"; exit 0; }

if [ "${1:-}" = "--all" ]; then
  files=$(git ls-files)
else
  files=$(git diff --cached --name-only --diff-filter=ACMR)
fi
[ -n "$files" ] || exit 0

scan() {
  echo "$files" | while IFS= read -r f; do
  [ -f "$f" ] || continue
  if echo "$f" | grep -qE '\.(png|woff2|apk)$'; then continue; fi
  if [ "${1:-}" = "--all" ]; then
    grep -nF -f "$words" -- "$f" 2>/dev/null | sed "s#^#$f:#" || true
  else
    git show ":$f" 2>/dev/null | grep -nF -f "$words" | sed "s#^#$f:#" || true
  fi
  done
}
hits=$(scan)

if [ -n "$hits" ]; then
  echo "check-private: personal data found, refusing:" >&2
  echo "$hits" | cut -c1-140 >&2
  exit 1
fi
echo "check-private: clean ($(wc -l < "$words" | tr -d ' ') private values checked)"
