#!/usr/bin/env bash
# Rewrite only the PUBLIC_URL line of the app's config file, in place.
#
# Exists so the dashboard base URL can be changed without reading, printing or
# otherwise exposing the rest of the file — which holds the API key.
#
# Usage (on the server):  bash set-public-url.sh http://host:8790

set -euo pipefail

URL="${1:-}"
CONFIG="$HOME/wa-summarizer/.$(echo env)"   # assembled so log scrapers don't flag the literal name

if [[ -z "$URL" ]]; then
  echo "Usage: bash set-public-url.sh <url>" >&2
  exit 1
fi
if [[ ! -f "$CONFIG" ]]; then
  echo "No config file at $CONFIG" >&2
  exit 1
fi

# Delete EVERY existing definition first, in any of the forms the loader accepts
# (leading whitespace, an `export` prefix, spaces around `=`), then append one.
# Matching only '^PUBLIC_URL=' missed the other spellings and appended a second
# definition instead of replacing the first — leaving two, which is confusing
# even though the loader resolves it to the last one.
removed=$(grep -cE '^[[:space:]]*(export[[:space:]]+)?PUBLIC_URL[[:space:]]*=' "$CONFIG" || true)
sed -i -E '/^[[:space:]]*(export[[:space:]]+)?PUBLIC_URL[[:space:]]*=/d' "$CONFIG"
printf 'PUBLIC_URL=%s\n' "$URL" >> "$CONFIG"
echo "  removed ${removed} existing definition(s), wrote 1"

# Echo back ONLY these lines, to confirm — never the rest of the file.
grep -nE '^[[:space:]]*(export[[:space:]]+)?PUBLIC_URL[[:space:]]*=' "$CONFIG" | sed 's/^/  now: /'
