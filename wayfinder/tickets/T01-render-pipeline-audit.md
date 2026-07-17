---
id: T01
title: Render-pipeline audit — where an anim clock and per-sprite frames can hook in
type: research
status: closed
assignee: research-subagent (fired 2026-07-16, charting session)
closed: 2026-07-16
blocked-by: []
map: ../map-alive-room.md
---

## Question

How are sprites and zones actually drawn today, and where would a low-fps animation clock
and per-sprite animation frames attach? Concretely, from `web/src/roomEngine.ts`,
`web/src/Room.tsx`, `web/src/room.css`, and `web/src/roomEngine.test.ts`:

1. Sprite drawing: procedural canvas rects? sprite-sheet? per-pixel arrays? What is a
   sprite's on-screen size in px / grid units — how much room is there for a readable
   "typing" or "hammer" motion and an over-head Zzz glyph?
2. The dirty-flag frame-loop contract between engine `step()` and the shell's rAF: what
   exactly keeps the shell awake (`moving`, fx, glow), and what is the cleanest seam to add
   "awake at ~4–8fps while any anim plays, zero frames otherwise" without breaking the
   zero-idle tests?
3. What per-sprite state already exists that anims can key off (status live/done, tweening,
   at-bench vs walking, arrAt/BOB_MS precedent for time-bounded animation)?
4. Which existing tests assert the zero-idle law, and what would they need to keep passing?

Deliverable: findings markdown at `wayfinder/research/T01-findings.md` with file:line
references. No code changes.

## Resolution (2026-07-16)

Full findings: [research/T01-findings.md](../research/T01-findings.md). Gist:

1. **Drawing = 100% procedural canvas** — no sprite-sheets. Bodies are rounded rects +
   eye rects (`Room.tsx:227-236`); anims must be small procedural shapes/glyphs in the
   same style, not frame art.
2. **Size budget** — session ~37px / bot ~27px diameter typical. Overhead glyph slot
   already established at `y - r - {3,5}*dpr`; bots free, session sprites must dodge the
   slot badge. Motion must be coarse: few-px accessory jitter or body squash/stretch.
3. **Recommended seam** — engine-side bounded anim window beside `arrAt`/`BOB_MS`, folded
   into `step()`'s `moving` (single truth signal); shell-side second rate-gate (~125-250ms)
   at the `Room.tsx:547` draw gate when `moving` is true *only* from the anim flag.
   Kinematic motion keeps full 30fps.
4. **Trigger state exists**: `zone !== '' && !tweening && phase === undefined` = settled
   at bench; `status`/`big` for sleep eligibility.
5. **Test constraint** — zero-idle tests (`roomEngine.test.ts:260-270`, `477-487`) assert
   settled floor returns `{moving:false, fx:[]}` forever with plain fixtures. Persistent
   sleep/work loops mean those fixtures WILL animate → tests must evolve; that call is
   Ticker-design's (T04) to make. `fx` must stay `[]` for anim-awake frames.
