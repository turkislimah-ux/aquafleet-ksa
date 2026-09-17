#!/bin/sh
# SHELL-DRIFT GUARD. The persistent agent shell keeps drifting out of the
# repo (/tmp workareas, home after a shell restart), and the failure then
# surfaces LATE — a half-run gate or a git command hitting the wrong tree.
# `npm test` and `npm run test:db` run this FIRST, so a drifted shell fails
# loudly on the gate's first line instead.
#
# WHY INIT_CWD AND NOT pwd: npm executes scripts with cwd = the package
# root no matter where npm was invoked, so `pwd` in here always looks
# correct. INIT_CWD (set by npm) is the directory the SHELL actually sat in
# when it typed `npm test` — that is the thing that must be the repo root.
# Run directly (no npm), INIT_CWD is unset and pwd is the honest answer.
root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
inv="${INIT_CWD:-$(pwd)}"
inv="$(CDPATH= cd -- "$inv" 2>/dev/null && pwd -P || echo "$inv")"
if [ "$inv" != "$root" ]; then
  echo "repo-root-check: REFUSING TO RUN — shell is at '$inv', repo root is '$root'." >&2
  echo "repo-root-check: cd \"$root\" and re-run. Never cd out of the repo; use a subshell ( cd <dir> && ... ) or absolute paths." >&2
  exit 1
fi
