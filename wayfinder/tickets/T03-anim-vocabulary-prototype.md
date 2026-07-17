---
id: T03
title: Anim-vocabulary prototype — 2–3 bench work-anims + Zzz to react to
type: prototype
status: closed
assignee: nino+fable (claimed 2026-07-16)
closed: 2026-07-16
blocked-by: [T01]
map: ../map-alive-room.md
---

## Question

What do the work-anims and the Zzz actually look like at pixel-sprite scale — and does the
taste land ("alive, not overdriven")? Build a cheap throwaway prototype (standalone canvas
page or a hacked local room, /prototype skill) showing:

- TERMINAL typing motion and WORKBENCH hammering (the two anchor benches), each in 2–4
  frames of motion;
- the sleeping Zzz per the ratified T02 rule: drifting Zs rising over a LIVE idle sprite
  at the podium (not a dimmed done-sprite), plus the ~300ms startle-beat wake;
- all running on the ~4–8fps ticker so the real cadence is judged, not a smooth fake.

Nino reacts live (HITL). Answer = the ratified motion language: frame counts, amplitude,
cadence, Zzz style — plus which remaining zones inherit a variant vs a shared generic anim
(graduates the "full zone coverage" fog). Judge shots hi-res per map Notes.

Asset: link the prototype location here on resolution.

## Resolution (2026-07-16, Nino reacted live)

Prototype: [prototypes/anim-vocab.html](../prototypes/anim-vocab.html) — standalone canvas
page, room palette/body style, real 4-8fps ticker, real-scale + 3x zoom rows, fps/amplitude
controls, wake button. All three anims ratified **as-is at subtle amplitude**:

- **TERMINAL typing**: two orange hand-rects tapping a keyboard shelf, burst rhythm
  (7 ticks typing, 3 rest — not a metronome), screen flicker per keystroke, slight body
  lean toward the bench while typing.
- **WORKBENCH hammer**: 5-tick cycle raise-raise-peak-STRIKE-recover; hammer = handle+head
  pivoting at body corner; body squash + 3 pixel sparks on the strike tick.
- **Sleep/wake**: drifting z/Z alternating sizes (~1 spawn per 1.2s, ~2.4s life, gentle
  sway, rise + fade), eyes become closed lines while asleep; wake = Zs pop + 300ms startle
  (hop, wide eyes, '!' overhead) then normal.
- **Zone coverage v1**: anchors bespoke (TERMINAL typing, WORKBENCH hammer); LIBRARY /
  ANTENNA / PLAN BOARD / SKILLS / PORTAL share one generic subtle "busy wiggle". More
  bespoke zones = later releases.
- Ticker fps default 6 in prototype; final fps value is Ticker design's (T04) call.
