#!/usr/bin/env bash
# tests/site/check_live.sh: health check of the *deployed* website (ARCHITECTURE section 15).
# CI checks the code; this checks what visitors actually get from the static host:
#   1. the page loads and carries the security headers from web/public/_headers;
#   2. every script and stylesheet the page references is served;
#   3. the engine is served as application/wasm (needed for streaming compilation);
#   4. the live ccsim.mjs + ccsim.wasm pass tests/wasm/smoke.mjs (Demo B, docs/WORKING_DEMO.md).
#
# Usage: tests/site/check_live.sh [base-url]        (default: https://cachesim.pages.dev)
# Needs: bash, curl, node >= 22. Exit: 0 healthy, 1 a check failed, 2 bad usage.
# Run from anywhere; network access only to the given site.

set -uo pipefail

base="${1:-https://cachesim.pages.dev}"
base="${base%/}"
case "$base" in
    http://* | https://*) ;;
    *) echo "usage: $0 [base-url]   (must start with http:// or https://)" >&2; exit 2 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
smoke="$here/../wasm/smoke.mjs"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0
pass() { echo "ok    $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }

# fetch <path> <file>: body to <file>, headers to <file>.h; prints the HTTP status (000 on error).
fetch() {
    curl -sS -L --max-time 30 --retry 2 --retry-delay 5 \
        -D "$2.h" -o "$2" -w '%{http_code}' "$base/$1" 2> "$2.err" || echo -n "000"
}
# header <file> <name>: the last value of a response header (after redirects), lowercased name match.
header() { grep -i "^$2:" "$1.h" | tail -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

echo "Checking $base"

# 1. Page and security headers.
code="$(fetch "" "$work/index.html")"
if [ "$code" = "200" ] && grep -q '<div id="root">' "$work/index.html"; then
    pass "page loads (HTTP 200)"
else
    fail "page: HTTP $code $(cat "$work/index.html.err" 2>/dev/null)"
fi
csp="$(header "$work/index.html" content-security-policy)"
case "$csp" in
    *"'wasm-unsafe-eval'"*) pass "Content-Security-Policy present" ;;
    *) fail "Content-Security-Policy missing or without 'wasm-unsafe-eval' (is _headers deployed?)" ;;
esac
[ "$(header "$work/index.html" x-content-type-options)" = "nosniff" ] \
    && pass "X-Content-Type-Options: nosniff" || fail "X-Content-Type-Options header missing"

# 2. Every script and stylesheet the page references (hashed names change on every build).
assets="$(grep -oE '(src|href)="\./assets/[^"]+"' "$work/index.html" | sed -E 's/^[a-z]+="\.\///; s/"$//' || true)"
if [ -z "$assets" ]; then
    fail "page references no ./assets/ files"
fi
for a in $assets; do
    code="$(fetch "$a" "$work/asset")"
    [ "$code" = "200" ] && [ -s "$work/asset" ] && pass "$a" || fail "$a: HTTP $code"
done

# 3. The engine files, as the worker loads them (<site>/engine/).
mkdir -p "$work/engine"
code="$(fetch "engine/ccsim.wasm" "$work/engine/ccsim.wasm")"
type="$(header "$work/engine/ccsim.wasm" content-type)"
magic="$(head -c 4 "$work/engine/ccsim.wasm" 2>/dev/null | od -An -tx1 | tr -d ' \n')"
if [ "$code" = "200" ] && [ "$magic" = "0061736d" ]; then
    pass "engine/ccsim.wasm ($(wc -c < "$work/engine/ccsim.wasm") bytes)"
else
    fail "engine/ccsim.wasm: HTTP $code, magic '$magic'"
fi
case "$type" in
    application/wasm*) pass "ccsim.wasm served as application/wasm" ;;
    *) fail "ccsim.wasm served as '$type', expected application/wasm" ;;
esac
code="$(fetch "engine/ccsim.mjs" "$work/engine/ccsim.mjs")"
[ "$code" = "200" ] && [ -s "$work/engine/ccsim.mjs" ] \
    && pass "engine/ccsim.mjs" || fail "engine/ccsim.mjs: HTTP $code"

# 4. The live engine itself, end to end. smoke.mjs exits 77 when policies are missing: a failure here.
if [ -s "$work/engine/ccsim.mjs" ] && [ -s "$work/engine/ccsim.wasm" ]; then
    rm -f "$work"/engine/*.h "$work"/engine/*.err
    if node "$smoke" "$work/engine/ccsim.mjs"; then
        pass "live engine passes tests/wasm/smoke.mjs"
    else
        fail "live engine failed tests/wasm/smoke.mjs (exit $?)"
    fi
else
    fail "live engine smoke test not run: engine files missing"
fi

if [ "$failures" -eq 0 ]; then
    echo "HEALTHY: every check passed for $base"
    exit 0
fi
echo "UNHEALTHY: $failures check(s) failed for $base"
exit 1
