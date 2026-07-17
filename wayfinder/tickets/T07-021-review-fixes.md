---
id: T07
title: 0.2.1 — post-release code-review fixes (anim law, wake beat, flicker)
type: task
status: closed
assignee: fable-2026-07-17
blocked-by: [T06]
map: ../map-alive-room.md
---

## Question

Nino ran a two-axis code review (standards smells + spec fidelity) on the 0.2.0
release diff (`4c045ba...e6fe0d2`). Seven findings, both axes independently
hitting the same engine/shell divergence. Fix them all, ship 0.2.1.

## Findings → fixes

1. **Duplicated anim law (engine `animEligible` + shell mirror)** → single
   exported `spriteAnim(c, now): 'work'|'sleep'|'startle'|undefined` in
   `roomEngine.ts`; `step()` aggregates it, the shell renders from it. No copy
   to drift.
2. **The copies had already drifted** (engine startle ungated by
   tweening/phase, shell gated) → resolved by #1: one law, settled-only, and
   the wake fix (#4) makes "startled while walking" unreachable by
   construction.
3. **Dead `anim='wiggle'` assignment in Room.tsx** → wiggle is offset-only now;
   the discriminant holds only values the accessory painter reads.
4. **T02 "beat, THEN walk" violated** (tool event waking a sleeper tweened
   immediately — the 300ms startle never rendered) → new `wakeTo` field (the
   `enterTo` pattern): routing parks during the beat, `step()` releases it when
   STARTLE_MS elapses. Any explicit `goTo` supersedes a stale pending route.
5. **T03 terminal "flicker" missing (README overclaimed it)** → blue monitor
   above the typing sprite, alpha keystroke-gated exactly like the ratified
   prototype (bright .85 on key ticks, dim .45 between).
6. **"Mirrors the engine law" comments were false** → comments now describe the
   single-law design.
7. **Repeated anim switch (mild)** → left as compute-then-paint (accepted in
   review); fold to a table if a 5th gesture lands.

## Evidence

- Tests 38/38 (2 new: T02 wake sequence beat→walk; spriteAnim single-law) +
  typecheck clean.
- Visual (fixture mock, puppeteer hi-res 3840, one browser per pass):
  `F:\ai\.scratch\room-shot\v021\` — flicker-0/1 (bright vs dim screen),
  sleep-podium (Zzz), full-52s. Startle-then-walk not reachable via the mock
  (SSE never targets the sleeper) — unit-tested instead.
- Review transcript: session 2026-07-17 (two opus agents, standards + spec).
