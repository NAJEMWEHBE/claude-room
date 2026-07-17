---
id: T05
title: Build — per-zone work-anims + sleep-Zzz in the real room, judged hi-res
type: task
status: closed
assignee: nino+fable (claimed 2026-07-16; opus executor spawned)
closed: 2026-07-16
blocked-by: [T02, T03, T04]
map: ../map-alive-room.md
---

## Question

Implement the ratified motion language (T03) on the ratified ticker (T04) with the
ratified sleep rule (T02) in `web/src/roomEngine.ts` + `web/src/Room.tsx`. Includes:

- work-anims for the zones T03 ratified (anchor benches bespoke, rest per T03's
  generic-variant decision);
- sleep-Zzz per T02's trigger/wake rule;
- zero-idle tests updated per T04; full test suite green;
- live judging: run the room against real sessions, capture ≥3840px verification shots of
  (a) a working bench mid-anim, (b) a sleeper with Zzz, (c) proof of zero frames on a
  fully-empty settled room — Nino-taste pass before this closes.

Heavy build → opus-4.8 executor with the fable-advisor checkpoint clause, per map Notes.

Answer = what shipped, test status, links to judged shots.

## Resolution (2026-07-16, opus executor + Fable review + Nino taste pass: APPROVED)

Shipped in working tree (4 files, uncommitted — Release ticket owns the commit):
- `web/src/roomEngine.ts` — `StepResult.anim` flag; `SLEEP_MS=45_000`/`STARTLE_MS=300`;
  per-session `lastEventAt`/`startleAt`; eligibility per T04 (bench-work / podium-sleep /
  startle window); no fx from anim logic.
- `web/src/Room.tsx` — three-tier draw gate (30fps motion / 6fps anim / zero) +
  `document.hidden` guard; per-sprite phase hash; typing (hands + keyboard hint + lean),
  hammer (5-tick arc, squash, INLINE sparks), generic busy-wiggle, sleep (closed eyes +
  drifting z/Z up-right of head), startle (hop + wide eyes + '!').
- `web/src/roomEngine.test.ts` — 36/36 green (33 baseline +3 net): empty-floor anim:false
  forever, occupied-settled anim:true, sleep-eligibility bounded, fx stays [].
- `README.md` — law sentence relabeled ("empty or hidden = zero frames; occupied ≤6fps").

Verification: tests rerun by orchestrator (36/36); tsc -b + oxlint clean; live room driven
against real sessions. Judged shots (3840×2160 full + zooms): `F:\ai\room-alive-full-3840.png`,
`room-alive-zoom-terminal.png` (phase-offset typing), `room-alive-zoom-workbench.png`
(hammer + sparks), plus live-tab sleep capture (closed eyes + drifting Zs, badge-clear).
Perf: headless 4K software-raster p50 4.2ms/rAF-cycle incl. app work, max 21ms outlier;
app frame work sub-ms outside draw ticks — bar met with margin on real GPU windows.
Capture tooling: `F:\ai\.scratch\room-shot\shot.mjs` (puppeteer-core; preview-MCP wedged —
reuse this for the Release gif). Nino taste pass: approved as-is.
