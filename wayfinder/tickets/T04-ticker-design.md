---
id: T04
title: Low-fps ticker design — persistent cheap anims under the zero-idle law
type: grilling
status: closed
assignee: nino+fable (claimed 2026-07-16)
closed: 2026-07-16
blocked-by: [T01]
map: ../map-alive-room.md
---

## Question

Design the animation clock so "keep law, low-fps loops" is real, not vibes. Decide (with
T01 findings in hand, /domain-modeling for the state words):

- Who owns anim state: engine `step()` (like BOB_MS/arrAt precedent) or a shell-side anim
  layer? One clock or per-sprite phase offsets (so a full bench doesn't type in lockstep)?
- Wake contract: exact rule for when the shell runs at anim-fps vs full-fps (walks/fx) vs
  zero frames. Hidden tab still zero.
- Frame budget: target fps for anims (4? 6? 8?), and the measurable bar (e.g. settled room
  with 5 sleepers ≤ X ms/s of main-thread time).
- Test strategy: how zero-idle tests evolve — new "anim-awake" state asserted, empty room
  still asserts zero frames.

Answer = ratified ticker architecture written into this ticket; build (T05) follows it.

## Resolution (2026-07-16, grilled with Nino; architecture per T01 audit seam)

- **fps locked: 6** (167ms/frame) — the cadence Nino ratified in the T03 prototype.
- **Clock ownership: engine.** Anim eligibility is engine state, exposed as a NEW
  `StepResult.anim: boolean` alongside `moving` (which stays kinematics-only — audit
  warned against overloading it, `roomEngine.test.ts:87-103` branches on genuine motion).
  - Work-anim eligible: `zone !== '' && zone !== podium && !tweening && phase ===
    undefined && status === 'live'` — at-bench = working by construction (idle tool ''
    already routes sprites home).
  - Sleep eligible (T02 rule): session (`big`), `status live`, at PODIUM, and
    `now - lastEventAt > 45_000`. Engine tracks per-session `lastEventAt`.
  - Startle (300ms) + arrival bob stay event-driven full-rate windows, per precedent.
- **Shell wake contract** (three tiers at the `Room.tsx:547` draw gate):
  1. `moving || fx || dirty || glow` → draw at existing ~30fps cap (real motion smooth);
  2. else `anim` → draw gated to 6fps (`now - lastAnimDraw >= 167`);
  3. else → zero draws. Hidden tab: `document.hidden` guard skips draws entirely
     (browser-throttled rAF + explicit guard).
- **Phase offsets: per-sprite.** Tick phase offset derived from sprite id hash so a full
  bench never types/wiggles in lockstep — same rationale as the polish-2 per-sprite
  walk-trail cadence.
- **Zero-idle law relabeled (public claim + README):** "an empty or hidden room draws
  zero frames; an occupied room idles at ≤6fps." Tests enforce both halves.
- **Test plan:** (a) empty-floor test asserts `{moving:false, anim:false, fx:[]}` forever;
  (b) NEW: occupied settled floor asserts `moving:false, anim:true`; (c) NEW: sleep
  eligibility bounded — `anim` false before 45s quiet, true after, false + startle on
  event (wake); (d) breathe-window test unchanged; (e) `fx` stays `[]` on anim frames.
- **Perf bar for the build (T05 gate):** anim-only frame ≤3ms main-thread on a 10-sprite
  floor (perf trace), empty-room zero-frame test green, plus Nino's hi-res taste pass.
