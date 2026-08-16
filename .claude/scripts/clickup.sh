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

now=$(date +%s)
if [[ -f "$lock_file" ]]; then
  until_ts=$(<"$lock_file")
  if (( now < until_ts )); then
    echo "LOCKED" >&2
    echo "RETRY_AFTER=$(( until_ts - now ))" >&2
    echo "RESET_AT=$(date -r "$until_ts")" >&2
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

remaining=$(grep -i '^x-ratelimit-remaining:' "$headers" | tr -d '\r' | awk '{print $2}')
reset=$(grep -i '^x-ratelimit-reset:' "$headers" | tr -d '\r' | awk '{print $2}')

if [[ "$status" == "429" ]]; then
  reset="${reset:-$(( now + 60 ))}"
  echo "$reset" > "$lock_file"
  echo "RATE_LIMITED" >&2
  echo "RETRY_AFTER=$(( reset - now ))" >&2
  echo "RESET_AT=$(date -r "$reset")" >&2
  exit 2
fi

echo "status=$status remaining=${remaining:-?} reset=${reset:-?}" >&2
cat "$respbody"
[[ "$status" -ge 400 ]] && exit 1
exit 0
