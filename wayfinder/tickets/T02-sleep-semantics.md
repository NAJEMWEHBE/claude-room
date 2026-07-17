---
id: T02
title: Sleep semantics — what state earns the Zzz, and when
type: grilling
status: closed
assignee: nino+fable (claimed 2026-07-16)
closed: 2026-07-16
blocked-by: []
map: ../map-alive-room.md
---

## Question

When is a sprite "sleeping"? Decide with Nino (grilling, one question at a time):

- Trigger: status `done`? idle-at-podium with no events for N seconds? both? What N?
- Do sessions and subagents sleep by the same rule, or do done-subagents (which exit the
  room) never sleep at all?
- Interplay with the existing done-dim: does Zzz replace the dim, stack with it, or does
  dim mean "gone" and Zzz mean "resting between prompts"?
- Wake: what event clears the Zzz instantly (any new tool event? prompt only?), and does
  waking get a tiny startle beat or an immediate cut?
- Cadence: Zzz drifting continuously (needs the low-fps ticker) vs pulsing every few
  seconds (time-bounded, cheaper)?

Answer = the ratified sleep-state rule, recorded here and gisted on the map.

## Resolution (2026-07-16, grilled with Nino)

Ratified sleep-state rule:

- **Trigger**: session sprite at PODIUM with no events for **45s** → asleep. Brief
  read-a-reply pauses stay awake.
- **Who**: **sessions only**. Subagents never sleep — they work then exit the gate.
- **Dim interplay**: **Zzz = live idle only.** Zzz means "alive, waiting for your
  prompt"; done sessions stay dimmed with NO Zzz. Two distinct readable states.
- **Wake**: any new prompt/tool event → Zzz pops away + **startle beat** (~300ms hop/
  shake, time-bounded like the arrival bob), then the sprite walks to work.
- **Cadence**: **drifting Zs** — small Zs continuously rise + fade over the head on the
  low-fps ticker (~4-8fps). Classic cartoon look; ticker exists anyway for work anims.
