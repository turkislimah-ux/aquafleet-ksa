#!/usr/bin/env bash
# Production build, guarded against the mistake that has cost this project
# real time twice.
#
# WHY THIS EXISTS
# `next build` writes to .next. `next dev` SERVES from .next. Run the build
# while dev is up and dev's compiled chunks are replaced by production ones
# under different hashes — the HTML still renders, every /_next/static/* asset
# 404s, and the app looks like it lost its styling. Nobody reads that symptom
# as "someone ran a build"; the first time it happened it was misdiagnosed as a
# UI regression and cost a session.
#
# HANDOFF.md §4 states the rule. A stated rule was not enough: the guard that
# preceded this script PRINTED a warning and let the build run anyway, which is
# worse than no guard at all — the transcript reads as if it was protected.
#
# So this EXITS. Non-zero, before touching .next.
#
# Usage:
#   ./scripts/safe-build.sh              # refuse if dev is up
#   ./scripts/safe-build.sh --dist-dir X # build elsewhere, safe while dev runs
set -euo pipefail

PORT="${DEV_PORT:-3002}"   # this project runs dev on 3002, not 3000

# --dist-dir sends output somewhere other than .next, which is the ONE way to
# build safely while dev keeps running. next.config.js reads NEXT_DIST_DIR.
DIST=""
if [[ "${1:-}" == "--dist-dir" ]]; then
  DIST="${2:?--dist-dir needs a directory}"
fi

if [[ -z "$DIST" ]]; then
  if lsof -ti:"$PORT" >/dev/null 2>&1; then
    cat >&2 <<EOF
REFUSING TO BUILD — next dev is live on port $PORT.

A production build would overwrite .next underneath it and every asset would
404 until dev is restarted. See HANDOFF.md section 4.

Do one of:
  1. Stop dev, then build:      pkill -f "next dev" && ./scripts/safe-build.sh
  2. Build somewhere else:      ./scripts/safe-build.sh --dist-dir .next-verify
     (leaves dev untouched, and restores tsconfig.json for you afterwards)
EOF
    exit 1
  fi
  echo "port $PORT clear — building into .next"
  exec npx next build
fi

# ---------------------------------------------------------------------------
# tsconfig.json IS RESTORED AFTERWARDS, BECAUSE next build REWRITES IT.
#
# `next build` normalises tsconfig.json in place: it expands every inline array
# to one-item-per-line, and it APPENDS "<distDir>/types/**/*.ts" to `include`.
# With --dist-dir that added path points at a directory that is temporary by
# definition, so the moment the build output is deleted the entry is a reference
# to nothing — permanently, in a tracked file.
#
# WHY THAT IS WORSE THAN IT SOUNDS: the reformatting turns it into a ~30-line
# diff on a file nobody edited, which is easy to wave through, and it lands in
# `git status` alongside real work. Phase 2.2c collected two of these
# (.next-profile-check and .next-profile-check2) and they were caught only
# because the status output was read line by line before staging. A batch using
# `git add -A` would have committed them silently.
#
# This script used to PRINT a reminder to run `git checkout -- tsconfig.json`.
# That is precisely the failure mode described at the top of this file — a guard
# that documents the hazard and then lets it happen. So it does it instead.
#
# ONLY ON THE --dist-dir PATH. A plain build into .next is left alone on
# purpose: ".next/types/**/*.ts" is already in the committed include list, and
# on a fresh clone Next may legitimately need to add it. Reverting that would
# strip the generated route types the build just produced.
# ---------------------------------------------------------------------------

# Anchored to the repo root, not the caller's cwd, so the snapshot is taken of
# the right file no matter where this is invoked from.
TSCONFIG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tsconfig.json"
SNAPSHOT=""

restore_tsconfig() {
  local status=$?
  if [[ -n "$SNAPSHOT" && -f "$SNAPSHOT" ]]; then
    if ! cmp -s "$SNAPSHOT" "$TSCONFIG"; then
      cp "$SNAPSHOT" "$TSCONFIG"
      echo "restored tsconfig.json — next build had rewritten it" >&2
    fi
    rm -f "$SNAPSHOT"
  fi
  return $status
}

if [[ -f "$TSCONFIG" ]]; then
  SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/tsconfig.safe-build.XXXXXX")"
  cp "$TSCONFIG" "$SNAPSHOT"
fi

# EXIT covers success and, under `set -e`, failure. INT and TERM route through
# `exit` so they reach the EXIT trap too — an interrupted build is exactly when
# a stale tsconfig would otherwise be left behind and blamed on something else.
trap restore_tsconfig EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "building into $DIST — dev on port $PORT is left alone"

# NOT `exec`. exec replaces this shell, so no trap could ever fire and the
# restore above would be dead code. The build's exit status still propagates:
# `set -e` exits on failure, and the EXIT trap preserves the status rather than
# overwriting it.
NEXT_DIST_DIR="$DIST" npx next build
