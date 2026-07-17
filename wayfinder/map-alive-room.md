# Map: Alive Room — working & sleeping animations

Label: `wayfinder:map`
Tracker: local-markdown (tickets = `wayfinder/tickets/*.md`, child issues of this map).
Frontier query: tickets with `status: open`, empty `assignee`, and every `blocked-by` id closed.

## Destination

A shipped claude-room npm release in which working sprites visibly *work* at their benches
(distinct small motion per zone — typing at TERMINAL, hammering at WORKBENCH, etc.), and
idle/settled sprites sleep with a cartoon Zzz over their heads — all under the kept
zero-idle law via a cheap low-fps ticker (~4–8fps, only while something animates; empty or
hidden room still draws zero frames). Judged on hi-res renders before publish.

## Notes

- **Execution override:** destination is a shipped release, so this map carries build +
  release tickets, not just decisions.
- Domain: `F:\ai\claude-room` — Node watcher + static React/Canvas page
  (`web/src/roomEngine.ts` = kinematics, `web/src/Room.tsx` = shell/renderer).
  Zero-idle law is ratified and README-documented; keep it.
- Zones: TERMINAL, WORKBENCH, LIBRARY, ANTENNA, PLAN BOARD, SKILLS, PORTAL, PODIUM, GATE.
- Nino rules that bind every session here: visual judging shots ≥3840px wide (iterate
  cheap, judge hi-res); subagents sonnet=scout / opus-4.8=heavy, never haiku; heavy spawns
  carry the fable-advisor checkpoint clause; option questions to Nino via AskUserQuestion;
  commit/publish only on Nino's go (release ticket must gate on his confirm);
  npm publish uses the 2FA flow in brain `npm-first-publish-2fa-flow`.
- Taste bar: subtle, cartoon-warm, "the room breathes" — never overdriven; anims must read
  at pixel-sprite scale.

## Decisions so far

<!-- one line per closed ticket: [title](tickets/file.md) — gist -->

- [Render-pipeline audit](tickets/T01-render-pipeline-audit.md) — pure procedural canvas
  (no sprite-sheets); seam = bounded anim window beside `arrAt`/`BOB_MS` folded into
  `step().moving` + a second ~4-8fps draw gate in the shell; overhead glyph slot exists;
  zero-idle tests must evolve (T04's call).
- [Sleep semantics](tickets/T02-sleep-semantics.md) — sessions only, podium + 45s quiet;
  Zzz = live idle (done stays dim, no Zzz); wake = startle beat then walk; drifting Zs on
  the low-fps ticker.
- [Anim-vocabulary prototype](tickets/T03-anim-vocabulary-prototype.md) — all three anims
  ratified as-is at subtle amplitude (burst typing + flicker; 5-tick hammer w/ squash +
  sparks; drifting z/Z + 300ms startle); coverage v1 = anchors bespoke, other zones share
  one generic busy-wiggle. Prototype: `wayfinder/prototypes/anim-vocab.html`.
- [Ticker design](tickets/T04-ticker-design.md) — 6fps locked; engine owns anim state via
  new `StepResult.anim` (moving stays kinematics-only); 3-tier draw gate (30fps motion /
  6fps anim / zero); per-sprite phase offsets; zero-idle law relabeled "empty or hidden =
  zero frames, occupied idles ≤6fps"; perf bar = ≤3ms anim frame on 10-sprite floor.
- [Build](tickets/T05-build-alive-anims.md) — SHIPPED in working tree (uncommitted): all
  anims live per spec, 36/36 tests, judged 3840px shots, Nino taste pass approved. Commit
  + publish belong to Release.
- [Release](tickets/T06-release.md) — **claude-room 0.2.0 published to npm 2026-07-17**
  (Nino-gated go). Commits fb38c82/a527183/6035b4d; GitHub release v0.2.0 → OIDC CI
  publish, green; tarball verified. README anim story + hero/gif/social refreshed; mock
  gained an idle `night-shift` session for the sleep path. **MAP COMPLETE — 6/6 closed.**

## Not yet specified

(nothing — map complete)

## Out of scope

- Ambient room life (light flicker, dust motes, critters, plants) — Nino scoped this
  effort to agent-tied animation only (2026-07-16).
- Sprite micro-idle while awake (breathe/blink/weight-shift when settled but not sleeping)
  — deselected; only work-anims and sleep-Zzz are in.
- Sound (keyboard ticks, chimes) — deselected.
- Crowd-chip (+N) animation — chips are aggregate honesty counters with no individual
  identity (per the render-pipeline audit); ruled out of v1 during Ticker design. Revisit
  as a fresh effort if overflowed benches feel dead after release. (Fable's call — veto
  and it becomes a ticket.)
