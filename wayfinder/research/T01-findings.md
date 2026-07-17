---
ticket: T01
title: Render-pipeline audit — where an anim clock and per-sprite frames can hook in
status: complete
---

# T01 findings — render pipeline audit

Sources studied: `web/src/roomEngine.ts` (565 lines), `web/src/Room.tsx` (598 lines),
`web/src/room.css` (121 lines), `web/src/roomEngine.test.ts` (515 lines). All line
numbers below refer to these files as they stood at audit time.

## 1. Sprite drawing: method, on-screen size, room for a typing/hammer motion + Zzz glyph

**Method: 100% procedural canvas drawing. No sprite-sheet, no pixel-array/bitmap assets.**
Every sprite is a rounded-rect "body" plus two rectangular "eyes" drawn with live
`CanvasRenderingContext2D` calls, re-issued every frame that redraws.

- `drawBody(x, y, r, col)` — `Room.tsx:227-236`. Draws one rounded square
  (`rrect(...,  r*0.45)` corner radius) via `roundRect`, fills `col`, strokes a dark
  outline (`rgba(0,0,0,.45)`), then punches two small dark rectangles for eyes
  (`ctx.fillRect` at `Room.tsx:234-235`). This is the entire sprite "sprite" — there is
  no image/texture anywhere in the file.
- `drawChip(c, now)` — `Room.tsx:250-342` — is the per-sprite paint routine called once
  per sprite per frame (`Room.tsx:430-432`). It computes render position (`sx(c.x)`,
  `sy(c.y)`), an entering/departing fade+scale (`Room.tsx:271-278`), the breathe-bob
  offset (`Room.tsx:283-295`), then calls `drawBody` for the body (`Room.tsx:296-297`),
  optionally a done/failed ring + check/cross glyph (`Room.tsx:298-305`), a slot-number
  badge for session sprites (`Room.tsx:306-317`), and name/model text labels
  (`Room.tsx:318-340`).
- Crowd ("+N") sprites are drawn as three tiny bodies in a row plus a text count above
  them — `Room.tsx:255-266`.
- Zones (benches) are also pure canvas: `paintZone()` (`Room.tsx:192-212`) draws a
  gradient-filled rounded rect + stroke + label text + icon glyph, baked once into an
  offscreen `<canvas>` layer (`bakeBg()`, `Room.tsx:348-365`) and blitted with one
  `drawImage` per frame (`Room.tsx:422-423`); a separate live `glowStroke()`
  (`Room.tsx:217-225`) is drawn on top only for zones whose glow timer is active.
- Data model: `Sprite` (`roomEngine.ts:146-177`) carries no drawing data at all
  (no frame index, no spritesheet coords) — only kinematic/state fields. All visuals
  are computed at draw time from `col`, `big`, `status`, `done`, `phase`, `arrAt`.

**On-screen size.** The engine works in a fixed 100×62 "design grid" (comment
`roomEngine.ts:33`), scaled to canvas pixels by `S` (`Room.tsx:76`, computed to fit
canvas dims to 104×66 design units incl. margin). Body radius in *design-grid units*:

- `SESS_BODY = 2.2` design units (`roomEngine.ts:83`) — big/session (orange Claude) sprites.
- `BOT_BODY = 1.6` design units (`roomEngine.ts:84`) — bot/subagent sprites.
- Render radius formula: `const r = (c.big ? 2.2 : 1.6) * S * pScale` — `Room.tsx:296`
  (the same 2.2/1.6 constants duplicated at render time; the engine comment at
  `roomEngine.ts:80-82` explicitly flags they "must track the render radii in Room.tsx").
- `S` itself = `Math.min((w*dpr)/104, (h*dpr)/66)` (`Room.tsx:76`) i.e. "design units to
  device px," so actual on-screen px depends on viewport/DPR. At a typical ~900×560 CSS
  canvas with dpr=1 (`Room.tsx:72-76`, default clientWidth/Height fallback), `S ≈
  min(900/104, 560/66) ≈ min(8.65, 8.48) = 8.48 px/unit`. That gives session bodies
  ≈ 2.2×8.48 ≈ **18.7 px radius (~37 px diameter)**, bot bodies ≈ 1.6×8.48 ≈ **13.6 px
  radius (~27 px diameter)**. On a larger/hi-DPR canvas (dpr capped at 2, `Room.tsx:50`)
  these scale up proportionally with `S`.
- Bench (zone) sizes are much bigger — e.g. `bench: { w: 17, h: 10 }` design units
  (`roomEngine.ts:43`) ≈ 144×85 px at the ~8.48 px/unit example above.

**Room for a typing/hammer motion + Zzz glyph.** There is real headroom above and
around each body already used by existing overlays, which gives a concrete budget:

- Overhead space: the done/failed check-or-cross glyph is drawn at `y - r - 3*dpr`
  (`Room.tsx:304`), and the crowd count label at `y - r - 5*dpr` (`Room.tsx:264`) — i.e.
  roughly one body-radius worth of clearance above the sprite is already the
  established "overhead glyph" zone. A Zzz glyph could reuse that same slot/pattern
  (small text glyph anchored at `x, y - r - k*dpr`), it just needs to not collide with
  the slot-number badge which sits at `x - r - 3*dpr, y - r - 1*dpr` for session sprites
  only (`Room.tsx:309-310`) — bot sprites have no badge there, so bots have a fully free
  overhead slot; session sprites would need the Zzz offset further up or to the side.
- Below-body space: name label sits at `y + r + 10*dpr` (`Room.tsx:328`), model label at
  `y + r + (19 or 10)*dpr` (`Room.tsx:339`) — so the space directly around/on top of the
  body itself (within ~±r) is otherwise unused and is where a small typing/hammer
  gesture (e.g. a tiny oscillating accessory rect near a hand position, or a body-local
  squash/stretch) would render without fighting existing overlays.
- Given body diameter is only ~27-37px in the common case, any "typing/hammer" motion
  needs to be a *small, coarse* gesture (a few px of offset/rotation on a tiny accessory
  shape, or a body-scale pulse) — there isn't room for a detailed multi-frame limb
  sprite; it should probably be implemented as a tiny extra procedural shape (e.g. a
  2-4px rect that jitters near the body) drawn in the existing `drawChip` procedural
  style, consistent with how eyes/badges are already hand-drawn shapes.

## 2. Dirty-flag frame-loop contract — what keeps the shell's rAF "awake," and the cleanest seam

**The contract (zero-idle law).** rAF always runs (`requestAnimationFrame(frame)` is
re-armed unconditionally at the top of `frame()`, `Room.tsx:510`), but the *canvas only
redraws* (`draw(now)`) when something is actually happening. The gate is at
`Room.tsx:547`:

```
if (stepped.moving || fx || dirty) { draw(now); dirty = false }
```

Contributing signals, all computed inside `frame()` (`Room.tsx:508-552`) each tick
(after the `t - last < 33` 30fps cap, `Room.tsx:512`):

- `stepped.moving` — from `engine.step(dt, now)` (`Room.tsx:525`), engine-owned. This is
  the primary kinematics signal: true while any sprite is `entering`, `tweening`,
  mid-`departing`-dematerialize, or inside its post-arrival `BOB_MS` breathe window, or
  while any crowd chip is still lerping toward its anchor (`follow()`,
  `roomEngine.ts:547-552`). Full logic in `RoomEngine.step()` — `roomEngine.ts:496-557`,
  specifically the `walk()` closure (`roomEngine.ts:502-545`) and its final line
  `if (c.arrAt !== undefined && now - c.arrAt < BOB_MS) moving = true`
  (`roomEngine.ts:543`).
- `fx` (local var in `frame()`, `Room.tsx:527`) — true while `FX.parts.length > 0`
  (live particles, e.g. walk-trail sparks / confetti / shake bursts,
  `Room.tsx:528-543`) or `FX.shake > 0.1` (`Room.tsx:544`).
- `dirty` (module-scope `let dirty = true` at `Room.tsx:61`, reset to `false` right
  after each draw at `Room.tsx:547`) — a general "something external changed" flag set
  by: `size()` on resize (`Room.tsx:80`), `playFx()` whenever any fx events arrived
  (`Room.tsx:150`), roster reconcile (`syncRoster` returning `dirty: true`,
  `Room.tsx:521`), SSE stream events (`onEvent` → `res.dirty`, `Room.tsx:482`), and
  click-to-focus (`onPointerDown`, `Room.tsx:461`).
- `engine.glowActive(now)` (`roomEngine.ts:560-563`, called at `Room.tsx:545`) — true
  while any zone's `glow[key]` timestamp (set on `goTo()`, `roomEngine.ts:219`, window
  = `GLOW_MS = 1500` ms, `roomEngine.ts:57`) hasn't elapsed. This feeds `fx` in
  `frame()`, so a glowing bench alone is enough to keep drawing even with a fully
  settled floor.

**BOB_MS breathe window** (`BOB_MS = 1400` ms, `roomEngine.ts:58`) is the one
*time-bounded, no-external-trigger* animation already in the engine: `walk()`
(`roomEngine.ts:542-544`) sets `moving = true` purely because `now - c.arrAt < BOB_MS`,
with no other state change required. The render side reads the *same* `arrAt` +
`BOB_MS` window independently to compute the bob's visual offset (`Room.tsx:283-295`,
`t = (now - c.arrAt) / BOB_MS`). This is the precedent pattern: engine owns a
timestamp + duration constant, exposes "still animating" via `moving` in `StepResult`,
shell reads the same timestamp to compute the actual visual delta. No canvas dirty-flag
plumbing needed beyond the existing `stepped.moving` channel.

**Cleanest seam for "awake at ~4-8fps while any anim plays, zero frames otherwise":**

The seam is exactly where `BOB_MS` already lives, generalized:

1. **Engine side** — add a per-sprite time-bounded (or state-bounded) "anim window"
   next to `arrAt`/`BOB_MS`, e.g. a new optional `Sprite` field such as
   `animUntil?: number` or a boolean state test (e.g. "at bench and not tweening" —
   see Q3), and fold it into the *existing* `moving` computation inside `walk()`
   (`roomEngine.ts:502-545`) or a small parallel check alongside line 543's breathe
   check. This keeps `StepResult.moving` as the single source of truth the shell
   already listens to (`Room.tsx:525`, `stepped.moving` feeds `Room.tsx:547`) — no new
   contract surface, no new field to thread through `frame()`.
2. **Rate-limiting to 4-8fps** — the shell's `frame()` already caps at ~30fps by
   comparing `t - last < 33` and returning early (`Room.tsx:512`). The clean way to get
   a slower cadence for anim-only frames without touching the "is anything happening"
   dirty logic is a **second, independent low-rate gate** purely for how often `draw()`
   is invoked while `stepped.moving` is only true because of the new anim flag (as
   opposed to real kinematic motion, which should stay at the existing cap for smooth
   walking). E.g. track `lastAnimDraw` and only call `draw()` when
   `now - lastAnimDraw >= ~125-250ms` (4-8fps) if the *only* reason `moving`/`dirty` is
   true is the new idle-anim flag; kinematic motion (tweening/entering/departing/glow/
   fx) should still draw at the full 30fps cap since that logic already exists and
   works. This can be implemented as a small branch right after line 547's condition
   check, without touching the engine's `moving` semantics at all.
3. **Zero-idle preserved by construction**: because the new flag is engine-state driven
   (tied to `arrAt`-like timestamps or discrete state, per Q3) and folds into the same
   `moving` boolean the zero-idle tests already assert against
   (`roomEngine.test.ts:260-270`, `roomEngine.test.ts:477-487`), a fully settled floor
   with no anim-eligible sprite still returns `{moving:false, fx:[]}` — the seam adds a
   *new source of `true`*, never removes the `false` floor. The zero-idle tests will
   keep passing as long as the anim window is bounded (time-based like `BOB_MS`, or
   cleared when the triggering state ends) rather than a permanently-true flag on a live sprite.

Naming the exact functions/flags involved: `RoomEngine.step()` (`roomEngine.ts:496`),
its inner `walk()` closure (`roomEngine.ts:502`), the `StepResult.moving` field
(`roomEngine.ts:196-199`), `Sprite.arrAt`/`BOB_MS` precedent (`roomEngine.ts:172`,
`roomEngine.ts:58`), the shell's `frame()` draw-gate (`Room.tsx:547`), and `dirty` /
`FX.parts.length` / `FX.shake` / `engine.glowActive()` as the other three signals
already ORed into that gate (`Room.tsx:525-546`).

## 3. Per-sprite state anims can key off

Fields on `Sprite` (`roomEngine.ts:146-177`) and derived state usable as animation
triggers, with what each means:

- **`status: string`** (`roomEngine.ts:151`, values `'live' | 'done' | 'failed'` per
  the `LiveAgent.status` comment at `roomEngine.ts:26`) — drives idle-dim today via
  `alphaFor()`: `if (c.big && c.status !== 'live') a *= IDLE_ALPHA` (`Room.tsx:174`,
  `IDLE_ALPHA = 0.55` at `Room.tsx:29`). This is the natural key for e.g. "done → sleep
  glyph" vs "live → active gesture."
- **`done: boolean`** (`roomEngine.ts:159`) — set `a.status !== 'live'`
  (`roomEngine.ts:404`, `roomEngine.ts:415`), drives the check/cross ring overlay
  (`Room.tsx:298-305`). Redundant-but-convenient boolean form of "not live."
- **`tweening?: boolean`** (`roomEngine.ts:168`) — true only during an active
  organic-walk bézier tween, set in `startWalk()` (`roomEngine.ts:284`) and cleared on
  arrival in `step()`'s `walk()` (`roomEngine.ts:527`). This is the "at-bench vs
  walking" signal: `!c.tweening && c.phase === undefined && c.zone` ≈ "settled at a
  station." Used at render time to gate the breathe bob: `if (c.arrAt !== undefined &&
  !c.tweening)` (`Room.tsx:283`).
- **`zone: string`** (`roomEngine.ts:157`) — current bench key (`''` = not yet routed /
  at the gate). Combined with `!tweening` and `phase === undefined`, this is exactly
  "at bench X, standing still" — the natural gate for a bench-specific idle gesture
  (typing at `pc`, hammering at `bench`, reading at `books`, etc. — could switch on
  `zone` value directly).
- **`phase?: 'entering' | 'departing'`** (`roomEngine.ts:174`) plus **`phaseT0?:
  number`** (`roomEngine.ts:175`) — gate lifecycle state; `undefined` = "settled on the
  floor" per the field comment (`roomEngine.ts:174`). Anim should almost certainly be
  suppressed while `phase` is set (entering/departing already have their own fade+scale
  cosmetic, `Room.tsx:271-278`).
- **`arrAt?: number`** (`roomEngine.ts:172`, "last arrival ts (drives the breathe
  window)") — **the direct precedent for time-bounded animation.** Set in `step()` on
  tween completion at a non-departing landing: `c.arrAt = now` (`roomEngine.ts:530`).
  Consumed both in the engine (`roomEngine.ts:543`, feeds `moving`) and in the shell
  (`Room.tsx:283-295`, feeds the bob's visual math). A new idle-anim window would be
  the same pattern: either reuse `arrAt` with a longer/second constant, or add a
  sibling timestamp field.
- **`count?: number`** (`roomEngine.ts:155`) — presence marks a crowd/+N chip (drawn via
  the three-tiny-bodies branch, `Room.tsx:255-266`); crowd sprites don't tween
  (`roomEngine.ts:163` comment) and use `follow()`-lerp instead of `walk()`
  (`roomEngine.ts:547-552`) — likely out of scope for a "typing/hammer" gesture (no
  individual identity), but relevant if Zzz/idle glyphs should also apply to crowds.
- **`big: boolean`** (`roomEngine.ts:150`) — session (true, orange "Claude") vs bot
  (false, job-colored) sprite; already used to size bodies (`Room.tsx:296`) and gate
  the slot-number badge (`Room.tsx:306-317`) — relevant for where an overhead Zzz glyph
  can be placed without colliding with the badge (see Q1).
- **`sid`, `id`, `job`/`l1`/`l2`** — identity/label fields, not animation-relevant
  directly but could be used to special-case a gesture by job type (e.g. only `bench`
  zone / `tester` job gets a hammer motion) — job→bench mapping is `JOB_META`
  (`roomEngine.ts:115-123`) and `jobOf()` (`roomEngine.ts:125-129`).

Summary of the closest existing precedent for "time-bounded per-sprite animation":
`arrAt` + `BOB_MS`, engine-set timestamp consumed by both `step()`'s `moving`
computation (`roomEngine.ts:543`) and the shell's render-time envelope math
(`Room.tsx:283-295`) — this is the template to copy for a new anim state.

## 4. Zero-idle tests — what they assert, what must stay true

In `roomEngine.test.ts`, the `describe('zero-idle law', ...)` block
(`roomEngine.test.ts:259-287`) has two tests:

- **`'settled floor: once tweens finish AND breathe elapses, step() draws nothing
  forever'`** (`roomEngine.test.ts:260-270`). Spawns a session + a kid, runs 200 frames
  to let entry+tween+breathe fully elapse (`run(e, 200)`, `roomEngine.test.ts:263`),
  then asserts for 10 more frames: `expect(r.moving).toBe(false)` and
  `expect(r.fx).toEqual([])` (`roomEngine.test.ts:266-267`), and finally
  `expect(e.glowActive(now + 60_000)).toBe(false)` (`roomEngine.test.ts:269`). This is
  the literal zero-frame law: on a truly settled floor, `step()` must return
  `{moving:false, fx:[]}` **every single call**, indefinitely, and `glowActive` must
  also be false (glow windows must expire, not persist).
- **`'breathe window keeps the floor awake right after arrival, then closes'`**
  (`roomEngine.test.ts:272-286`). Steps until `s.arrAt` is set (landing), then asserts
  `e.step(DT, s.arrAt! + 100).moving` is `true` (still inside `BOB_MS`,
  `roomEngine.test.ts:283`) and `e.step(DT, s.arrAt! + 1500).moving` is `false` (past
  `BOB_MS = 1400`, `roomEngine.test.ts:285`). This asserts the breathe window is
  strictly time-bounded and *does* close — `moving` isn't allowed to stay true forever
  just because a sprite once arrived.

Additionally, two more tests elsewhere assert the same zero-frame property in other
scenarios (both would need to keep holding):

- `'mid-walk re-sync: target and progress survive, walk continues'`
  (`roomEngine.test.ts:87-103`) doesn't test *zero* frames but tests `moving` reflects
  genuine kinematic state (`expect(moving).toBe(true)` at `roomEngine.test.ts:102`) —
  relevant because a new anim-only `moving=true` source must not be confused with
  "genuinely walking" if any other code branches on that distinction.
- `'exit: a leaver dematerializes at the gate then is gone; zero-idle restored'`
  (`roomEngine.test.ts:477-487`) — after a full departure cycle, loops 8 frames
  asserting `expect(r.moving).toBe(false); expect(r.fx).toEqual([])`
  (`roomEngine.test.ts:486`) — same zero-frame contract, exercised post-exit rather
  than post-settle.

**What must stay true after adding a low-fps anim ticker:**

1. `step()` must still return `{moving:false, fx:[]}` on a floor where **no sprite is
   eligible for the new idle-anim state** — i.e. the new anim trigger must be opt-in /
   bounded, not "any settled sprite always animates forever." If the intent is
   "any settled sprite plays a subtle idle loop indefinitely," that would directly
   break `roomEngine.test.ts:260-270` (which uses ordinary session+kid fixtures with no
   special "idle anim" opt-in) **unless** the existing zero-idle fixtures are
   understood to now legitimately keep animating — that's a product decision, but as
   currently written the test's fixtures (plain `session()`/`kid()`, no bench-specific
   or Zzz-eligible state) would need the new anim window to still expire/not-apply for
   this exact scenario, OR the test itself would need updating (which the ticket's
   read-only research scope does not authorize).
2. The breathe-window test's *shape* (`roomEngine.test.ts:272-286`) is the pattern any
   new time-bounded anim state should follow: `moving` true strictly inside a bounded
   window, false strictly outside it, keyed off a stored timestamp compared to `now`.
3. `fx` must remain `[]` when nothing is emitting particles — a low-fps "awake" flag
   should only affect `moving`/draw cadence, not spuriously push `FxEvent`s, or the
   `expect(r.fx).toEqual([])` assertions break.
4. `glowActive()` must still return `false` once all glow windows expire
   (`roomEngine.test.ts:269`) — unrelated to the new seam but confirms *all* awake
   sources in the engine are time-bounded; a new anim-until timestamp should follow the
   same expiring-timer discipline as `glow[key]` (`roomEngine.ts:560-563`) and `arrAt`.

## Recommended seam (short)

Add a bounded per-sprite `animUntil?`/state-derived flag next to `Sprite.arrAt`
(`roomEngine.ts:172`), folded into `RoomEngine.step()`'s existing `walk()` moving-check
(`roomEngine.ts:543`) exactly like `BOB_MS` is today — so `StepResult.moving`
(`roomEngine.ts:196-199`) remains the single truth signal the shell already reads
(`Room.tsx:525`). In the shell, keep the existing 30fps draw path for real kinematic
motion untouched, but add a second, independent rate-gate (~125-250ms /  4-8fps) around
`draw()` calls (`Room.tsx:547`) specifically for frames where `moving` is true *only*
because of the new idle-anim flag (no tweening/entering/departing/glow/particles in
play) — Q2's `frame()` gate is the exact place to branch this. Trigger condition per
Q3: `zone !== '' && !tweening && phase === undefined` (settled at a bench) — optionally
narrowed to specific `zone`/`job` values for typing-vs-hammer-vs-Zzz variety — with a
bounded window (mirroring `arrAt`/`BOB_MS`) so a sprite doesn't animate forever once
eligible, keeping the zero-idle tests' `{moving:false, fx:[]}` floor
(`roomEngine.test.ts:260-270`, `roomEngine.test.ts:477-487`) provably reachable and the
breathe-window pattern (`roomEngine.test.ts:272-286`) satisfied for the new state too.
Rendering itself (Q1) needs no new asset pipeline — reuse the existing pure-canvas
`drawChip` style (`Room.tsx:250-342`), drawing a small extra procedural shape/glyph
near the body (overhead slot already established at `y - r - {3,5}*dpr`,
`Room.tsx:264`, `Room.tsx:304`) sized to the ~27-37px body diameter (`SESS_BODY=2.2` /
`BOT_BODY=1.6` design units, `roomEngine.ts:83-84`, scaled by `S`, `Room.tsx:76`).
