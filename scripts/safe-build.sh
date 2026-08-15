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
     (leaves dev untouched; remember next build rewrites tsconfig.json, so
      git checkout -- tsconfig.json afterwards)
EOF
    exit 1
  fi
  echo "port $PORT clear — building into .next"
  exec npx next build
fi

echo "building into $DIST — dev on port $PORT is left alone"
NEXT_DIST_DIR="$DIST" exec npx next build
