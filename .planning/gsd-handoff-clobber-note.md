# The gsd HANDOFF.json clobber — known upstream bug, fixed before we hit it

**Status: NOT a defect to report. Already fixed upstream. We were running a stale
plugin.**

This file was originally written as an upstream bug report. It is kept, corrected,
because two things in it are worth remembering: the real mechanism, and how the
investigation went wrong.

---

## What it was

- **Upstream issue:** [buildomator/buildomator#17][17] — "PostToolUse checkpoint hook
  wipes HANDOFF.json (idle projects) and creates `.planning/` in non-GSD dirs"
- **Reported** 2026-06-27, **closed COMPLETED** 2026-06-28 (commit `79c5f63`)
- **Fixed in v4.0.1**, with a CI regression gate so it cannot silently return
- **We were on gsd 3.4.4** (2026-06-09) — predating the fix by two months
- The repo moved: `jnuyens/gsd-plugin` → `buildomator/buildomator`. Latest is v4.5.5
  (2026-08-07).

[17]: https://github.com/buildomator/buildomator/issues/17

The GSD staleness reminder flagged the 68-day-old plugin at session start. It was
read past. That notice was the whole answer.

## The real mechanism — not the one we diagnosed

We concluded: *this repo has no `.planning/STATE.md`, so `generateCheckpoint` gathers
nothing and writes an empty skeleton.*

That is **wrong as a root cause**, though it produced the right symptom for us. The
actual mechanism, found by a commenter on #17 and reproduced against our own copy:

`bin/lib/checkpoint.cjs` destructures from `core.cjs`:

```js
const { planningPaths, safeReadFile, execGit, findPhaseInternal, output } = require('./core.cjs');
```

but `core.cjs` no longer exports two of them:

```
$ node -e "const c=require('<plugin>/bin/lib/core.cjs'); for (const k of ['planningPaths','safeReadFile','execGit','findPhaseInternal','output']) console.log(k, typeof c[k])"
planningPaths      function
safeReadFile       undefined   <--
execGit            undefined   <--
findPhaseInternal  function
output             function
```

Verified `undefined` on our 3.4.4 too. So every `safeReadFile(statePath)` and
`execGit(...)` inside `generateCheckpoint()` throws `TypeError: x is not a function`,
the surrounding `catch {}` swallows it, and the empty skeleton is written **whether or
not `STATE.md` exists**. The rest of the codebase had migrated to a new
`execGit(['args'], { cwd })` signature; `checkpoint.cjs` was left behind on the old
one, importing helpers from a module that had stopped providing them.

**Why the distinction matters:** our explanation predicted the bug only bites projects
without a `STATE.md`. The true one bites every idle GSD project as well. Had the
report been filed, it would have pointed the maintainer at the gathering logic instead
of a stale import.

## The upstream fix (v4.0.1)

Two early-return guards in `writeCheckpoint()`, before any filesystem mutation:

- no-op when `.planning/` does not already exist (stops `.planning/` being created in
  non-GSD directories)
- no-op for any non-`manual-pause` source when both `phase` and `task` are null (stops
  the null skeleton being written over a hand-authored file)

`/gsd:pause-work` still writes through the `manual-pause` bypass; active phase/task
work still checkpoints. Covered by `tests/checkpoint-write-guards.test.cjs` (8 cases),
gated in CI on every push.

Note the shape of the fix: **guard on "is there anything worth saying", not on
provenance.** An empty checkpoint conveys nothing, so refusing to write one costs
nothing — simpler than parsing the target to ask who wrote it.

## What we did, and why it still stands

We renamed our snapshot to `.planning/AQUAFLEET-HANDOFF.json` and gitignored gsd's
(`804c67b`).

**Keep it.** It was the right call for the wrong reason, and it survives the
correction:

- It holds regardless of plugin version, upgrade timing, or regression. The upstream
  fix is good, but we would be relying on it staying good.
- `.planning/` is shared ground. gsd is one tenant; the next tool that wants a
  handoff file will reach for the same obvious name.
- The general rule is unchanged: **when two tools claim one path, move the path.**
  Hardening our write discipline was tried first and failed three times.

Do **not** re-derive this and "clean up" the rename on the grounds that the upstream
bug is fixed.

## Two investigation lessons

**Search the issue tracker before writing the report, not after.** A full root-cause
write-up was produced for a bug that had been reported, diagnosed more accurately by
someone else, fixed, and shipped with a CI gate — two months before we hit it. The
cost was not the wasted write-up; it was nearly filing a duplicate with a wrong cause
attached to it.

**A stale-dependency notice is a hypothesis, not noise.** "Your cached plugin is 68
days old" appeared at session start and was skipped as boilerplate. For a bug in a
third-party tool, version age deserves to be the *first* check, ahead of reading its
source.

## Follow-up, Turki's to action — and NOT via the commands gsd prints

gsd's staleness reminder tells you to run `/plugin marketplace update` +
`/plugin install gsd@gsd-plugin`. **Those do not apply to this machine.** There is no
`gsd-plugin` marketplace in the CLI tree (`~/.claude/plugins/marketplaces/` holds only
`claude-plugins-official` and `supabase-agent-skills`). gsd is installed through the
**Claude desktop app**, recorded in its own manifest under
`~/Library/Application Support/Claude/local-agent-mode-sessions/.../rpm/`:

```json
{ "name": "gsd", "marketplaceName": "gsd-plugin",
  "installedBy": "user", "updatedAt": "2026-06-09T18:38:18Z" }
```

So: **update or disable it from the desktop app's plugin UI.** Do not hand-patch the
`rpm/` directory — the manifest is app-owned and a hand-swapped plugin desyncs from it.

Version jump is safe if you do update: v4.0.0's notes call the major "a divergence
signal, not a breaking change — existing commands, config, and planning artifacts work
unchanged."

**Disabling is the better option unless gsd starts being used here.** Nothing in this
project depends on it — no `STATE.md`, no phase dirs, no gsd command ever run — while
it does cost something: a `PreToolUse` guard that nags to route edits through
`/gsd:quick`, and a plugin `CLAUDE.md` directive telling the model to auto-run
`/gsd:resume-work` on sight of a `.planning/HANDOFF.json`. After `804c67b` its
checkpoint cannot reach our file either way.

**Third lesson, and the same shape as the other two:** the fix instructions printed by
a tool were wrong for this install, and got repeated twice before anyone checked where
the plugin actually lived. Verify the install path before running a vendor's suggested
remedy — same reflex as verifying the version before reading its source.

## Two git details worth keeping

Both came out of chasing this, and neither is gsd-specific:

- **Check the staged blob, not the working tree.**
  `git cat-file -s $(git ls-files -s <path> | awk '{print $2}')`. A file can be correct
  on disk and blank in the index — that is exactly how the third clobber nearly got
  committed.
- **`git checkout -- <path>` restores from the INDEX, not HEAD.** With a blank blob
  already staged, the reflexive restore writes the blank over itself and reports
  success. Recovery is `git checkout HEAD -- <path>`.

Both are in `CLAUDE.md` §5.
