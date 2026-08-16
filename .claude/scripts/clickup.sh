#!/usr/bin/env bash
# Direct ClickUp API v2 caller. Personal token, no OAuth connector.
#
# Usage: clickup.sh METHOD /v2/path [json-body]
#
# On success: response body on stdout, rate-limit status on stderr.
# On 429, or while a prior 429's cooldown hasn't elapsed: refuses (or lets
# the live call happen and records the new cooldown), prints RETRY_AFTER=<s>
# on stderr, exits 2. Never retries by itself — the caller decides.
set -euo pipefail

token_file="$HOME/.config/clickup/token"
lock_file="$HOME/.config/clickup/lockout"
base="https://api.clickup.com/api"

method="${1:?usage: clickup.sh METHOD /v2/path [json-body]}"
path="${2:?usage: clickup.sh METHOD /v2/path [json-body]}"
body="${3:-}"

# GNU coreutils spells "this integer is an epoch" `-d @<ts>`; `-r <ts>` is the
# BSD form and reads as "the mtime of the file named <ts>" here, which fails.
human_time() { date -d "@$1"; }

# An epoch that did not come back as digits is worse than no epoch: every
# arithmetic context below is `(( ))`, which aborts the script on a non-numeric
# operand under `set -e`.
epoch_or_empty() { [[ "$1" =~ ^[0-9]+$ ]] && echo "$1" || echo ''; }

now=$(date +%s)
if [[ -f "$lock_file" ]]; then
  until_ts=$(epoch_or_empty "$(<"$lock_file")")
  if [[ -n "$until_ts" ]] && (( now < until_ts )); then
    echo "LOCKED" >&2
    echo "RETRY_AFTER=$(( until_ts - now ))" >&2
    echo "RESET_AT=$(human_time "$until_ts")" >&2
    exit 2
  fi
fi

headers=$(mktemp)
respbody=$(mktemp)
trap 'rm -f "$headers" "$respbody"' EXIT

curl_args=(-sS -D "$headers" -o "$respbody" -X "$method"
  -H "Authorization: $(<"$token_file")"
  -H "Content-Type: application/json")
[[ -n "$body" ]] && curl_args+=(-d "$body")

status=$(curl "${curl_args[@]}" -w '%{http_code}' "$base$path")

# `|| true` is load-bearing, not defensive noise: grep exits 1 when a header is
# absent, `pipefail` promotes that to the pipeline, and `set -e` would kill the
# script right here — before the 429 branch below, the one branch that has to
# survive a response whose headers are not what we expect. Losing it means the
# cooldown is never recorded and the caller re-hammers a throttled token.
header_value() { grep -i "^$1:" "$headers" | tr -d '\r' | awk '{print $2}' || true; }

remaining=$(header_value 'x-ratelimit-remaining')
reset=$(epoch_or_empty "$(header_value 'x-ratelimit-reset')")

if [[ "$status" == "429" ]]; then
  reset="${reset:-$(( now + 60 ))}"
  echo "$reset" > "$lock_file"
  echo "RATE_LIMITED" >&2
  echo "RETRY_AFTER=$(( reset - now ))" >&2
  echo "RESET_AT=$(human_time "$reset")" >&2
  exit 2
fi

echo "status=$status remaining=${remaining:-?} reset=${reset:-?}" >&2
cat "$respbody"
[[ "$status" -ge 400 ]] && exit 1
exit 0
