/* Churn contract for the Room engine.
 * External behavior only: rosters + events in, sprite
 * state + fx out. No canvas, no React, no timers — `now` is a plain number
 * and rng is seeded, so every run is deterministic.
 *
 * The crowd-saturation fixtures use the real backend job label
 * 'researcher' (homes to web, the tightest bot cap). */
import { describe, it, expect } from 'vitest'
import { RoomEngine, zoneBotCap, GATE_X, GATE_Y, GATE_STAGGER, ZONES, SESS_BODY, BOT_BODY, center } from './roomEngine'
import type { LiveAgent } from './roomEngine'

const rng = () => 0.5 // jitter-free: (rng()-0.5) === 0
const T0 = 1_000_000

function session(sid: string, tool = 'Read', status = 'live'): LiveAgent {
  return { id: 'S' + sid, kind: 'session', session: sid, name: 'claude', job: '', detail: '', model: 'fable', status, age_s: 1, project: 'proj-' + sid, tool }
}
function kid(id: string, sid: string, status = 'live', job = 'builder'): LiveAgent {
  return { id, kind: 'subagent', session: sid, name: id, job, detail: '', model: 'opus', status, age_s: 1 }
}
function snapshot(e: RoomEngine) {
  const dump = (m: Map<string, { x: number; y: number; tx: number; ty: number; zone: string }>) =>
    [...m.entries()].map(([k, s]) => ({ k, x: s.x, y: s.y, tx: s.tx, ty: s.ty, zone: s.zone }))
  return JSON.stringify({ s: dump(e.sessions), b: dump(e.bots), c: dump(e.crowds) })
}
// step N frames at a fixed dt, advancing `now` like a real clock (the organic-walk tween
// and the breathe window are both time-based, so `now` MUST move for them to progress/end).
const DT = 33
function run(e: RoomEngine, frames: number, now0 = T0): number {
  let now = now0
  for (let i = 0; i < frames; i++) { now += DT; e.step(DT, now) }
  return now
}

describe('roster churn — sprites survive', () => {
  it('same roster re-delivered (fresh array, same ids) is a total no-op', () => {
    const e = new RoomEngine(rng)
    const roster = [session('aaaa1111'), kid('k1', 'aaaa1111')]
    e.syncRoster(roster, T0)
    // let them walk a bit so positions are mid-flight, not at spawn
    run(e, 5)
    const before = snapshot(e)
    const res = e.syncRoster(roster.map((a) => ({ ...a })), T0 + 3000) // fresh objects, same data
    expect(snapshot(e)).toBe(before) // positions, targets, zones all untouched
    expect(res.fx).toEqual([]) // no spawn fx, no toasts, no confetti
  })

  it('one agent joins: exactly one new sprite, everyone else untouched', () => {
    const e = new RoomEngine(rng)
    const r1 = [session('aaaa1111'), kid('k1', 'aaaa1111')]
    e.syncRoster(r1, T0)
    run(e, 5)
    const k1Before = { ...e.bots.get('k1')! }
    const sBefore = { ...e.sessions.get('aaaa1111')! }
    e.syncRoster([...r1, kid('k2', 'aaaa1111')], T0 + 3000)
    expect(e.bots.size).toBe(2)
    const k1After = e.bots.get('k1')!
    expect([k1After.x, k1After.y, k1After.tx, k1After.ty]).toEqual([k1Before.x, k1Before.y, k1Before.tx, k1Before.ty])
    const sAfter = e.sessions.get('aaaa1111')!
    expect([sAfter.x, sAfter.y, sAfter.tx, sAfter.ty]).toEqual([sBefore.x, sBefore.y, sBefore.tx, sBefore.ty])
    // newcomer enters through the bottom-wall gate (the portal is retired), not routed yet
    const k2 = e.bots.get('k2')!
    expect(k2.phase).toBe('entering')
    expect(k2.y).toBe(GATE_Y)
    expect(Math.abs(k2.x - GATE_X)).toBeLessThanOrEqual(GATE_STAGGER)
  })

  it('one agent leaves: walks out through the gate, no confetti-pop, floor untouched', () => {
    const e = new RoomEngine(rng)
    const r1 = [session('aaaa1111'), kid('k1', 'aaaa1111'), kid('k2', 'aaaa1111')]
    e.syncRoster(r1, T0)
    run(e, 80) // settle (entry + tween + breathe elapse)
    const k1Before = { ...e.bots.get('k1')! }
    const res = e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111')], T0 + 3000)
    // k2 does NOT vanish — it begins the ratified exit (walk to the gate, then dematerialize)
    expect(e.bots.has('k2')).toBe(true)
    expect(e.bots.get('k2')!.phase).toBe('departing')
    expect(res.fx.filter((f) => f.kind === 'confetti')).toHaveLength(0) // confetti-pop retired
    const k1After = e.bots.get('k1')!
    expect([k1After.x, k1After.y]).toEqual([k1Before.x, k1Before.y]) // the stayer is untouched
    // let the exit play out — k2 is removed once it dematerializes at the gate
    run(e, 80, T0 + 3000)
    expect(e.bots.has('k2')).toBe(false)
    expect([e.bots.get('k1')!.x, e.bots.get('k1')!.y]).toEqual([k1Before.x, k1Before.y])
  })

  it('mid-walk re-sync: target and progress survive, walk continues', () => {
    const e = new RoomEngine(rng)
    const roster = [session('aaaa1111', 'Bash')]
    e.syncRoster(roster, T0)
    const s = e.sessions.get('aaaa1111')!
    // clear the gate entry, then take a couple of frames into the organic walk to the bench
    let now = T0
    while (s.phase === 'entering' && now < T0 + 2000) { now += DT; e.step(DT, now) }
    now += DT; e.step(DT, now); now += DT; e.step(DT, now)
    const mid = { x: s.x, y: s.y, tx: s.tx, ty: s.ty }
    expect(mid.x).not.toBe(mid.tx) // genuinely mid-flight
    expect(s.tweening).toBe(true)
    e.syncRoster(roster.map((a) => ({ ...a })), now + 3000)
    expect({ x: s.x, y: s.y, tx: s.tx, ty: s.ty }).toEqual(mid) // survives the refresh
    const { moving } = e.step(DT, now + 3000 + DT)
    expect(moving).toBe(true) // still walking, from where it was — no snap-back
  })
})

describe('toasts — once, honestly, never replayed', () => {
  it('live→done fires exactly one toast; re-syncs never repeat it', () => {
    const e = new RoomEngine(rng)
    const r1 = [session('aaaa1111'), kid('k1', 'aaaa1111', 'live')]
    e.syncRoster(r1, T0)
    const r2 = [session('aaaa1111'), kid('k1', 'aaaa1111', 'done')]
    const res = e.syncRoster(r2, T0 + 3000)
    expect(res.fx.filter((f) => f.kind === 'toast')).toHaveLength(1)
    const res2 = e.syncRoster(r2.map((a) => ({ ...a })), T0 + 6000)
    expect(res2.fx.filter((f) => f.kind === 'toast')).toHaveLength(0)
  })

  it('first sight of an already-done agent is silent (no replay on mount)', () => {
    const e = new RoomEngine(rng)
    const res = e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111', 'done')], T0)
    expect(res.fx.filter((f) => f.kind === 'toast')).toHaveLength(0)
  })

  it('failed child raises shake, done child raises confetti', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111', 'live'), kid('k2', 'aaaa1111', 'live')], T0)
    const res = e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111', 'failed'), kid('k2', 'aaaa1111', 'done')], T0 + 3000)
    expect(res.fx.some((f) => f.kind === 'shake')).toBe(true)
    expect(res.fx.some((f) => f.kind === 'confetti')).toBe(true)
  })
})

describe('sessions', () => {
  it('tool change walks the session; same tool holds the bench', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111', 'Read')], T0)
    const s = e.sessions.get('aaaa1111')!
    const now = run(e, 25) // enter through the gate + route to the first bench
    expect(s.zone).toBe('books')
    e.syncRoster([session('aaaa1111', 'Read')], now + 100)
    expect(s.zone).toBe('books') // same tool: holds the bench
    e.syncRoster([session('aaaa1111', 'Bash')], now + 3000)
    expect(s.zone).toBe('bench') // tool change: walks
  })

  it('session leaving walks out through the gate, then is removed', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111'), session('bbbb2222')], T0)
    const now = run(e, 60) // settle both
    expect(e.sessions.size).toBe(2)
    e.syncRoster([session('bbbb2222')], now)
    expect(e.sessions.get('aaaa1111')!.phase).toBe('departing') // exiting, still on the floor
    expect(e.sessions.has('bbbb2222')).toBe(true)
    run(e, 90, now) // walk to gate + dematerialize
    expect(e.sessions.has('aaaa1111')).toBe(false)
    expect(e.sessions.has('bbbb2222')).toBe(true)
  })

  it('SSE PreToolUse walks the session instantly; UserPromptSubmit sends it home', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111', '')], T0)
    const s = e.sessions.get('aaaa1111')!
    const now = run(e, 25) // enter through the gate + settle at the podium
    expect(s.zone).toBe('podium')
    const res = e.applyStreamEvent({ event: 'PreToolUse', tool: 'Edit', session: 'aaaa1111', detail: 'x.ts' }, now)
    expect(s.zone).toBe('pc')
    expect(res.hud).toContain('Edit')
    e.applyStreamEvent({ event: 'UserPromptSubmit', session: 'aaaa1111' }, now + 100)
    expect(s.zone).toBe('podium')
  })

  it('work sparks wait for the walker — none while mid-walk, back once settled (polish-3)', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111', '')], T0)
    const s = e.sessions.get('aaaa1111')!
    let now = run(e, 25) // through the gate, settled at the podium
    // zone-changing event: the walk starts NOW, the bench must not spark yet
    const away = e.applyStreamEvent({ event: 'PreToolUse', tool: 'Edit', session: 'aaaa1111', detail: 'x.ts' }, now)
    expect(s.tweening).toBe(true)
    expect(away.fx.filter((f) => f.kind === 'emit')).toHaveLength(0)
    // settle at the bench, then the same tool again: sparks resume at the worker
    while (s.tweening && now < T0 + 60_000) { now += DT; e.step(DT, now) }
    expect(s.zone).toBe('pc')
    const settled = e.applyStreamEvent({ event: 'PreToolUse', tool: 'Edit', session: 'aaaa1111', detail: 'y.ts' }, now)
    const sparks = settled.fx.filter((f) => f.kind === 'emit')
    expect(sparks).toHaveLength(1)
    expect(sparks[0]).toMatchObject({ n: 6, up: true, col: ZONES.pc.line })
  })
})

describe('crowd — per-ZONE +N (room-polish-crowd-saturation)', () => {
  // researcher kids all home to the ANTENNA bench (web), the tightest bot cap,
  // so a handful saturate it — a crisp per-zone overflow fixture.
  const fetcher = (i: number, status = 'live') => kid('k' + i, 'aaaa1111', status, 'researcher')

  it('overflow beyond a bench legible cap folds into ONE per-zone +N; count tracks', () => {
    const e = new RoomEngine(rng)
    const cap = zoneBotCap('web') // grid capacity of the ANTENNA bench
    const kids = Array.from({ length: cap + 3 }, (_, i) => fetcher(i))
    e.syncRoster([session('aaaa1111'), ...kids], T0)
    // a saturated bench shows cap−1 bodies (last cell reserved for the chip) + one honest +N
    expect(e.bots.size).toBe(cap - 1)
    expect(e.crowds.get('zone:web')!.l1).toBe('+' + (cap + 3 - (cap - 1)))
    // drop to cap+1: still overflowing → cap−1 shown, +2
    e.syncRoster([session('aaaa1111'), ...kids.slice(0, cap + 1)], T0 + 3000)
    expect(e.crowds.get('zone:web')!.l1).toBe('+2')
    // drop to exactly cap: everything fits, the chip is gone
    e.syncRoster([session('aaaa1111'), ...kids.slice(0, cap)], T0 + 6000)
    expect(e.bots.size).toBe(cap)
    expect(e.crowds.has('zone:web')).toBe(false)
  })

  it('the +N groups by BENCH, not by session — bots from two sessions share one bench chip', () => {
    const e = new RoomEngine(rng)
    const cap = zoneBotCap('web')
    // cap+2 researchers split across TWO parent sessions, all homing to the same bench
    const a = Array.from({ length: cap }, (_, i) => kid('a' + i, 'sessionaa', 'live', 'researcher'))
    const b = Array.from({ length: 2 }, (_, i) => kid('b' + i, 'sessionbb', 'live', 'researcher'))
    e.syncRoster([session('sessionaa'), session('sessionbb'), ...a, ...b], T0)
    // ONE chip for the bench (not one per session), counting the whole bench overflow
    const chips = [...e.crowds.keys()].filter((k) => k.startsWith('zone:'))
    expect(chips).toEqual(['zone:web'])
    expect(e.crowds.get('zone:web')!.count).toBe(cap + 2 - (cap - 1))
  })

  it('demotion into the +N (bench filled past cap) never fires exit confetti', () => {
    const e = new RoomEngine(rng)
    const cap = zoneBotCap('web')
    // k0 done from FIRST SIGHT (silent) + (cap−1) live = exactly cap → all fit, no chip yet
    const base = [fetcher(0, 'done'), ...Array.from({ length: cap - 1 }, (_, i) => fetcher(i + 1))]
    e.syncRoster([session('aaaa1111'), ...base], T0)
    expect(e.bots.has('k0')).toBe(true)
    // one more LIVE researcher saturates the bench → live-first sort demotes the done k0 into the +N
    const res = e.syncRoster([session('aaaa1111'), ...base, fetcher(9)], T0 + 3000)
    expect(e.bots.has('k0')).toBe(false)
    expect(e.crowds.get('zone:web')!.count).toBe(2) // cap+1 present, cap−1 shown → 2 hidden
    // k0 is still on the roster — losing its cell to the cap is demotion, NOT an exit
    expect(res.fx.filter((f) => f.kind === 'confetti')).toHaveLength(0)
  })

  it('at saturation the shown bodies stay inside the bench height — no vertical stacking overlap', () => {
    const e = new RoomEngine(rng)
    const z = ZONES.pc // builders home here; a taller bench that packs 2 rows
    const cap = zoneBotCap('pc')
    const kids = Array.from({ length: cap + 5 }, (_, i) => kid('k' + i, 'aaaa1111')) // builders → pc
    e.syncRoster([session('aaaa1111'), ...kids], T0)
    run(e, 120) // let the shown bots walk into their cells
    for (const b of e.bots.values()) {
      expect(b.ty - BOT_BODY).toBeGreaterThanOrEqual(z.y - 1e-6)
      expect(b.ty + BOT_BODY).toBeLessThanOrEqual(z.y + z.h + 1e-6) // body never crosses the bench floor
    }
    // the +N chip itself is parked inside the bench too
    const chip = e.crowds.get('zone:pc')!
    expect(chip.tx - BOT_BODY).toBeGreaterThanOrEqual(z.x - 1e-6)
    expect(chip.tx + BOT_BODY).toBeLessThanOrEqual(z.x + z.w + 1e-6)
  })
})

describe('zero-idle law', () => {
  it('settled floor: once tweens finish AND breathe elapses, step() draws nothing forever', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111')], T0)
    const now = run(e, 200) // walk everyone in + tweens done + breathe window elapsed
    for (let i = 0; i < 10; i++) {
      const r = e.step(DT, now + i * DT)
      expect(r.moving).toBe(false) // truly zero frames
      expect(r.fx).toEqual([])
    }
    expect(e.glowActive(now + 60_000)).toBe(false)
  })

  it('breathe window keeps the floor awake right after arrival, then closes', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111', 'Read')], T0)
    // step until the session lands on its bench (arrAt is set on the bench landing, after
    // it clears the gate) — capture the arrival time
    let now = T0
    const s = e.sessions.get('aaaa1111')!
    while (s.arrAt === undefined && now < T0 + 5000) { now += DT; e.step(DT, now) }
    expect(s.tweening).toBe(false)
    expect(s.arrAt).toBeGreaterThan(0)
    // immediately after landing: breathe keeps it moving (awake to draw the bob)
    expect(e.step(DT, s.arrAt! + 100).moving).toBe(true)
    // past the breathe window: fully still
    expect(e.step(DT, s.arrAt! + 1500).moving).toBe(false)
  })
})

describe('organic walk — ratified motion', () => {
  it('travels a curved path: the walk bows off the straight start→target line', () => {
    // rng != 0.5 so the perpendicular bend is non-zero (0.5 would give a straight line)
    const e = new RoomEngine(() => 0.85)
    e.syncRoster([session('aaaa1111', 'Bash')], T0) // gate -> workbench, a real diagonal
    const s = e.sessions.get('aaaa1111')!
    let now = T0
    while (s.phase === 'entering' && now < T0 + 2000) { now += DT; e.step(DT, now) } // clear the gate; the walk tween is now armed
    const sx0 = s.sx!, sy0 = s.sy!, tx = s.tx, ty = s.ty
    const A = ty - sy0, B = -(tx - sx0), C = -(A * sx0 + B * sy0)
    const denom = Math.hypot(A, B) || 1
    // track the MAX perpendicular deviation across the whole tween (the bow peaks mid-walk)
    let maxPerp = 0
    for (let i = 0; i < 60 && s.tweening; i++) {
      now += DT; e.step(DT, now)
      maxPerp = Math.max(maxPerp, Math.abs(A * s.x + B * s.y + C) / denom)
    }
    expect(maxPerp).toBeGreaterThan(1) // genuinely bowed, not a straight line
  })

  it('lands exactly on target and then holds it (bézier resolves to the endpoint)', () => {
    const e = new RoomEngine(() => 0.85)
    e.syncRoster([session('aaaa1111', 'Bash')], T0)
    const s = e.sessions.get('aaaa1111')!
    run(e, 120) // finish the tween
    expect(s.tweening).toBe(false)
    expect(s.x).toBeCloseTo(s.tx, 6)
    expect(s.y).toBeCloseTo(s.ty, 6)
  })

  it('walk-trail cadence is PER-SPRITE — a co-walker neither starves nor doubles the trail (polish-2)', () => {
    // count the trail-emit events attributable to s1 (nearest-sprite wins; s1 emits sit exactly
    // on s1). Under the old shared engine tick, adding an even-count co-walker flipped s1's
    // parity and starved/doubled its trail; per-sprite cadence must make s1's count IDENTICAL
    // whether it walks alone or beside another walker.
    const s1Trails = (rows: [string, string][]): number => {
      const e = new RoomEngine(rng)
      e.syncRoster(rows.map(([sid, tool]) => session(sid, tool)), T0)
      let now = T0, emits = 0
      for (let i = 0; i < 120; i++) {
        now += DT
        const r = e.step(DT, now)
        const s1 = e.sessions.get('s1')!, s2 = e.sessions.get('s2')
        for (const f of r.fx) {
          if (f.kind !== 'emit') continue
          const d1 = Math.abs(f.x - s1.x) + Math.abs(f.y - s1.y)
          const d2 = s2 ? Math.abs(f.x - s2.x) + Math.abs(f.y - s2.y) : Infinity
          if (d1 <= d2 && d1 < 2) emits++ // this emit belongs to s1
        }
      }
      return emits
    }
    const solo = s1Trails([['s1', 'Read']]) // s1 → library, alone
    const duo = s1Trails([['s1', 'Read'], ['s2', 'WebFetch']]) // s2 → antenna, opposite side
    expect(solo).toBeGreaterThan(3) // s1 genuinely laid a trail
    expect(duo).toBe(solo) // ...unchanged by the co-walker — cadence is per-sprite
  })
})

describe('per-zone fan-out geometry (polish-1 HIGH) — bodies stay inside the bench', () => {
  // route N sessions to explicit zones by tool, then settle so goTo/fanSessions has run
  const routed = (rows: [string, string][]): RoomEngine => {
    const e = new RoomEngine(rng)
    e.syncRoster(rows.map(([sid, tool]) => session(sid, tool)), T0)
    run(e, 60)
    return e
  }
  const within = (tx: number, zoneKey: string) => {
    const z = ZONES[zoneKey]
    return tx - SESS_BODY >= z.x - 1e-6 && tx + SESS_BODY <= z.x + z.w + 1e-6
  }

  it('a session alone in a zone sits dead-centre — never shoved off by its global slot', () => {
    // two sessions, DIFFERENT zones: the old global-slot offset floated the 2nd off its
    // (empty) zone centre. Per-zone, each is the sole occupant → centred on its own bench.
    const e = routed([['aaaa1111', 'Read'], ['bbbb2222', 'Bash']]) // books, workbench
    const a = e.sessions.get('aaaa1111')!, b = e.sessions.get('bbbb2222')!
    expect(a.zone).toBe('books'); expect(b.zone).toBe('bench')
    expect(a.tx).toBeCloseTo(center(ZONES.books).x, 6)
    expect(b.tx).toBeCloseTo(center(ZONES.bench).x, 6)
  })

  it('multiple sessions in the SAME zone fan out centred, spaced ≤5.6, all inside the bench', () => {
    const e = routed([['s1', 'Read'], ['s2', 'Grep'], ['s3', 'Glob']]) // all → books
    const xs = ['s1', 's2', 's3'].map((s) => e.sessions.get(s)!)
    for (const s of xs) { expect(s.zone).toBe('books'); expect(within(s.tx, 'books')).toBe(true) }
    const sorted = xs.map((s) => s.tx).sort((p, q) => p - q)
    // gaps clamped to the ratified 5.6 ceiling and symmetric about the zone centre
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeLessThanOrEqual(5.6 + 1e-6)
    const mid = (sorted[0] + sorted[sorted.length - 1]) / 2
    expect(mid).toBeCloseTo(center(ZONES.books).x, 6)
  })

  it('a session joining an occupied zone re-centres the whole row (no fixed global slot)', () => {
    const e = routed([['s1', 'Read']]) // alone in books → centred
    expect(e.sessions.get('s1')!.tx).toBeCloseTo(center(ZONES.books).x, 6)
    e.syncRoster([session('s1', 'Read'), session('s2', 'Grep')], T0 + 5000) // s2 joins books
    run(e, 60, T0 + 5000)
    const a = e.sessions.get('s1')!, b = e.sessions.get('s2')!
    expect(a.zone).toBe('books'); expect(b.zone).toBe('books')
    expect(a.tx).not.toBeCloseTo(center(ZONES.books).x, 3) // the incumbent shifted to make room
    expect((a.tx + b.tx) / 2).toBeCloseTo(center(ZONES.books).x, 6) // still centred as a pair
    expect(within(a.tx, 'books')).toBe(true); expect(within(b.tx, 'books')).toBe(true)
  })

  it('HIGH count: 6 sessions crammed in one zone all keep their bodies inside the bench', () => {
    const e = routed([['s1', 'Read'], ['s2', 'Grep'], ['s3', 'Glob'], ['s4', 'Read'], ['s5', 'Grep'], ['s6', 'Glob']])
    for (let i = 1; i <= 6; i++) {
      const s = e.sessions.get('s' + i)!
      expect(s.zone).toBe('books')
      expect(within(s.tx, 'books')).toBe(true) // body edge never crosses the bench wall
    }
  })

  it('bots pack a deterministic grid inside their home bench — no rng pileup, no overlap', () => {
    const e = new RoomEngine(rng)
    const kids = Array.from({ length: 3 }, (_, i) => kid('k' + i, 'aaaa1111')) // builders → pc
    e.syncRoster([session('aaaa1111'), ...kids], T0)
    run(e, 80)
    const z = ZONES.pc
    const cells = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const b = e.bots.get('k' + i)!
      expect(b.zone).toBe('pc')
      expect(b.tx - BOT_BODY).toBeGreaterThanOrEqual(z.x - 1e-6)
      expect(b.tx + BOT_BODY).toBeLessThanOrEqual(z.x + z.w + 1e-6)
      expect(b.ty - BOT_BODY).toBeGreaterThanOrEqual(z.y - 1e-6)
      expect(b.ty + BOT_BODY).toBeLessThanOrEqual(z.y + z.h + 1e-6)
      cells.add(b.tx.toFixed(3) + ',' + b.ty.toFixed(3))
    }
    expect(cells.size).toBe(3) // three distinct packed cells, deterministic
  })
})

describe('spawn gate — enter & exit through the ratified airlock door', () => {
  it('a new session spawns AT the bottom-wall gate mouth, in the entering phase', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111', 'Read')], T0)
    const s = e.sessions.get('aaaa1111')!
    expect(s.phase).toBe('entering')
    expect(s.y).toBe(GATE_Y)
    expect(Math.abs(s.x - GATE_X)).toBeLessThanOrEqual(GATE_STAGGER)
    expect(s.zone).toBe('') // not routed to a bench yet — it routes only after the walk-up
  })

  it('a lone arrival lands dead-centre at the mouth; simultaneous arrivals flank it symmetrically', () => {
    const solo = new RoomEngine(rng)
    solo.syncRoster([session('aaaa1111', 'Read')], T0)
    expect(solo.sessions.get('aaaa1111')!.x).toBe(GATE_X) // dead-centre, not the old off-centre x−4

    const many = new RoomEngine(rng)
    many.syncRoster([session('aaaa1111', 'Read'), session('bbbb2222', 'Read'), session('cccc3333', 'Read')], T0)
    const xs = ['aaaa1111', 'bbbb2222', 'cccc3333'].map((id) => many.sessions.get(id)!.x).sort((a, b) => a - b)
    expect(xs).toEqual([GATE_X - GATE_STAGGER, GATE_X, GATE_X + GATE_STAGGER]) // spread across the mouth, one centred
  })

  it('a new subagent enters through the SAME gate — portal ring + parent beam retired', () => {
    const e = new RoomEngine(rng)
    const res = e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111')], T0)
    const b = e.bots.get('k1')!
    expect(b.phase).toBe('entering')
    expect(b.y).toBe(GATE_Y)
    expect(Math.abs(b.x - GATE_X)).toBeLessThanOrEqual(GATE_STAGGER)
    // the parent dispatch 'beam' FxEvent variant was deleted outright — the type system now
    // guarantees no beam can be emitted, so the old runtime filter is gone.
    expect(res.fx.filter((f) => f.kind === 'emit' && f.ring)).toHaveLength(0) // no portal ring
  })

  it('entry completes: the sprite clears the gate then routes to its station', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111', 'Read')], T0)
    const s = e.sessions.get('aaaa1111')!
    run(e, 8) // ~264ms into the 620ms entry
    expect(s.phase).toBe('entering')
    expect(s.y).toBeLessThan(GATE_Y) // walking up through the door
    run(e, 22) // past ENTRY_MS: phase clears, it heads for its bench
    expect(s.phase).toBeUndefined()
    expect(s.zone).toBe('books') // Read -> library
  })

  it('a burst of simultaneous spawns lateral-staggers across the mouth (no stack)', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('s1'), session('s2'), session('s3')], T0)
    const xs = [...e.sessions.values()].map((s) => s.x)
    expect(new Set(xs).size).toBe(3) // three distinct mouth columns
    for (const x of xs) expect(Math.abs(x - GATE_X)).toBeLessThanOrEqual(GATE_STAGGER)
  })

  it('exit: a leaver dematerializes at the gate then is gone; zero-idle restored', () => {
    const e = new RoomEngine(rng)
    e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111')], T0)
    let now = run(e, 120) // settle
    const res = e.syncRoster([session('aaaa1111')], now) // k1 leaves the roster
    expect(res.fx.filter((f) => f.kind === 'confetti')).toHaveLength(0)
    expect(e.bots.get('k1')!.phase).toBe('departing')
    now = run(e, 120, now) // walk to gate + dematerialize + settle
    expect(e.bots.has('k1')).toBe(false)
    for (let i = 0; i < 8; i++) { const r = e.step(DT, now + i * DT); expect(r.moving).toBe(false); expect(r.fx).toEqual([]) } // quiet floor
  })
})

/* ---- claude-room v0.1 kind-strips (not in MC's suite): the kid whitelist ---- */
describe('v0.1 kind whitelist — crew/job/harness roster kinds are dropped', () => {
  it('non-session, non-subagent/workflow kinds never become sprites, crowds, or toasts', () => {
    const e = new RoomEngine(rng)
    const strays: LiveAgent[] = ['crew', 'job', 'harness'].map((k, i) => ({
      id: 'x' + i, kind: k, session: 'aaaa1111', name: 'stray-' + k, job: 'builder',
      detail: '', model: 'opus', status: 'live', age_s: 1,
    }))
    e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111'), ...strays], T0)
    expect(e.bots.size).toBe(1) // only the real subagent
    expect(e.bots.has('k1')).toBe(true)
    expect(e.crowds.size).toBe(0)
    // flipping a stray's status raises no toast — it was never tracked
    const flipped = strays.map((a) => ({ ...a, status: 'done' }))
    const res = e.syncRoster([session('aaaa1111'), kid('k1', 'aaaa1111'), ...flipped], T0 + 3000)
    expect(res.fx.filter((f) => f.kind === 'toast')).toHaveLength(0)
  })

  it('workflow kind IS a swarm member (whitelisted alongside subagent)', () => {
    const e = new RoomEngine(rng)
    const wf: LiveAgent = { id: 'w1', kind: 'workflow', session: 'aaaa1111', name: 'wf-1', job: 'builder', detail: '', model: 'opus', status: 'live', age_s: 1 }
    e.syncRoster([session('aaaa1111'), wf], T0)
    expect(e.bots.has('w1')).toBe(true)
  })
})
