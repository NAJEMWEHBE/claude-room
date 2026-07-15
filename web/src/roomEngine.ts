/* ------------------------------------------------------------------ *
 * ROOM ENGINE — pure sprite-state core of THE ROOM diorama.
 * Extracted as a pure module so roster
 * churn behavior is deterministically testable and the respawn glitch
 * (engine re-init on roster-id change) is dead by construction: ONE
 * engine instance lives for the whole component mount; rosters flow
 * through syncRoster() and only ever *reconcile* — never rebuild.
 *
 * Contract: no canvas, no DOM, no React, no ambient time/randomness —
 * `now` is passed in, randomness comes from the injected rng. Anything
 * visual (particles, confetti, toasts, shake, glow) is returned as an FxEvent for
 * the shell to render; the engine only owns sprite state + kinematics.
 *
 * v0.1 scope: session + subagent/workflow roster kinds only
 * (kids whitelist in syncRoster).
 * ------------------------------------------------------------------ */

export interface LiveAgent {
  id: string
  kind: string // session | subagent | workflow
  session: string // 8-char: a session's own id, or a child's PARENT session
  name: string
  job: string
  detail: string
  model: string
  status: string // live | done | failed
  age_s: number
  project?: string
  task?: string
  tool?: string
}

/* colored diorama benches on a 100x62 design grid (from the original) */
export interface Zone {
  x: number; y: number; w: number; h: number
  col: string; line: string; label: string; ic: string
}
// Fills locked to one HSL band (L~14.5%, S~34%), borders a consistent brighter tint of the
// SAME hue (L~44%, S~52%) — so the 8 benches read as one coordinated set, differentiated by
// hue only (polish-4, 2026-07-11). PODIUM is the neutral stage: lifted L + desaturated so
// it's visible without competing. Geometry + icons unchanged.
export const ZONES: Record<string, Zone> = {
  bench: { x: 44, y: 8, w: 17, h: 10, col: '#322418', line: '#ab6c36', label: 'WORKBENCH', ic: '🔧' },
  web: { x: 74, y: 9, w: 15, h: 10, col: '#18322b', line: '#36ab8d', label: 'ANTENNA', ic: '📡' },
  pc: { x: 20, y: 13, w: 17, h: 11, col: '#182432', line: '#366cab', label: 'TERMINAL', ic: '>_' },
  plan: { x: 46, y: 38, w: 16, h: 9, col: '#1d1832', line: '#4936ab', label: 'PLAN BOARD', ic: '📋' },
  books: { x: 20, y: 36, w: 17, h: 11, col: '#1a3218', line: '#40ab36', label: 'LIBRARY', ic: '📚' },
  crew: { x: 74, y: 36, w: 15, h: 11, col: '#281832', line: '#8036ab', label: 'PORTAL', ic: '🌀' },
  skills: { x: 8, y: 24, w: 8, h: 9, col: '#322b18', line: '#ab8d36', label: 'SKILLS', ic: '✨' },
  podium: { x: 50, y: 24, w: 14, h: 8, col: '#242830', line: '#4f6592', label: 'PODIUM', ic: '🎙' },
}
export const ZONE_KEYS = Object.keys(ZONES)
export const center = (z: Zone) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 })

export const CLAUDE_ORANGE = '#ff9d4d'
export const CROWD_COL = '#8892b0'
export const GLOW_MS = 1500
export const BOB_MS = 1400 // breathe-on-arrival window: time-bounded

// ---- spawn gate (ratified Airlock door, room-build-gate 2026-07-11). ONE door centred on
// the bottom wall; sessions AND subagents enter + exit through it (kind stays legible by
// sprite colour). All gate FX are short bursts on spawn/despawn — a settled door is static. ----
export const ENTRY_MS = 620 // door-open + fade-in + walk-up beat
export const EXIT_MS = 480 // walk-to-door + dematerialize beat
export const GATE_X = 50 // door mouth, grid x (bottom-wall centre)
export const GATE_Y = 61 // door mouth, grid y (just inside the bottom wall)
export const ENTRY_RISE = 4 // grid units the sprite walks up off the mouth before it routes
export const GATE_STAGGER = 4 // lateral offset so simultaneous spawns don't stack on the mouth

// organic-walk easing (ratified motion). easeOutBack peaks ~1.10 around p≈0.6 then
// settles to exactly 1 at p=1 → a small arrival overshoot on the bézier param (the
// exact landing rides on easeOutBack(1)===1 plus the c.x=c.tx snap in step()).
const easeOutBack = (p: number): number => { const c1 = 1.70158, c3 = c1 + 1; const q = p - 1; return 1 + c3 * q * q * q + c1 * q * q }
// point on a quadratic bézier s→c→t at parameter e
const qbez = (s: number, c: number, t: number, e: number): number => { const u = 1 - e; return u * u * s + 2 * u * e * c + e * e * t }
// gate-entry glide easing (ratified): fast off the mark, soft landing
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

// sprite body radii in DESIGN-GRID units — must track the render radii in Room.tsx
// (drawChip: (c.big ? 2.2 : 1.6) * S). Fan-out/packing clamp bodies inside their bench
// against these, so labels + bodies stop floating outside the zone (polish-1 HIGH).
export const SESS_BODY = 2.2
export const BOT_BODY = 1.6

// How many bot BODIES a bench can hold legibly = cols×rows of its packed grid at ~3u spacing
// (room-polish-crowd-saturation, 2026-07-12). packBots lays out at most this many bodies +
// one per-zone "+N" chip; the rest of a bench's overflow folds into that chip. Deriving the
// cap from the SAME grid math packBots uses guarantees the rows always fit the bench height —
// the old unbounded `rows = ceil(n/cols)` let a saturated narrow bench stack bodies past its
// floor and overlap. Bot cell = BOT_BODY-padded, label band reserved at top.
// Single source of truth for bench-grid geometry: zoneBotCap (how many fit) and packBots (where
// they sit) both derive from this, so the cell size / padding can never drift between the two
// (they were duplicated — code-review nit). padTop reserves the label band at the top.
const GRID_CELL = 3.0
function benchGrid(z: Zone): { padX: number; padTop: number; usableW: number; usableH: number; maxCols: number; maxRows: number } {
  const padX = BOT_BODY + 0.4, padTop = 3.0, padBot = BOT_BODY + 0.4
  const usableW = Math.max(0.2, z.w - 2 * padX)
  const usableH = Math.max(0.2, z.h - padTop - padBot)
  const maxCols = Math.max(1, Math.floor(usableW / GRID_CELL) || 1)
  const maxRows = Math.max(1, Math.floor(usableH / GRID_CELL) || 1)
  return { padX, padTop, usableW, usableH, maxCols, maxRows }
}
export function zoneBotCap(key: string): number {
  const g = benchGrid(ZONES[key] || ZONES.podium)
  return g.maxCols * g.maxRows
}
// label truncation with an ellipsis so a clipped name reads as clipped, not as a hard cut
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/* subagent job -> body colour + home bench. Pure lookup on the backend's OWN
 * classification (the watcher's _job_type labels) — NO re-classifying here.
 * Keys are the SEVEN backend labels; the default is the backend's fallthrough
 * label (documented today as cyan/books). */
const JOB_META: Record<string, { col: string; home: string }> = {
  reviewer: { col: '#ff6b7d', home: 'plan' },
  scout: { col: '#a878ff', home: 'books' },
  builder: { col: '#46e6a4', home: 'pc' },
  tester: { col: '#ffc25a', home: 'bench' },
  researcher: { col: '#38a8ff', home: 'web' },
  architect: { col: '#e7c66a', home: 'plan' },
  helper: { col: '#38e8ff', home: 'books' },
}
const DEFAULT_JOB_META = { col: '#38e8ff', home: 'books' }
export function jobOf(a: LiveAgent): { col: string; home: string } {
  // real backend label wins; an ABSENT/unknown job falls through to the default
  // (v0.1: crew-kind purple branch out of scope — crew kids never appear here)
  return JOB_META[a.job] || DEFAULT_JOB_META
}

/* tool -> bench (ported) */
export function zoneForTool(tool: unknown): string {
  if (typeof tool !== 'string' || !tool) return 'podium' // defensive: shrug off malformed payloads
  const t = tool.toLowerCase()
  if (t.startsWith('mcp__')) return 'crew'
  if (t === 'skill') return 'skills'
  if (/^(read|grep|glob)/.test(t)) return 'books'
  if (/^(edit|write|notebookedit|multiedit)/.test(t)) return 'pc'
  if (/^(bash|powershell|killshell)/.test(t)) return 'bench'
  if (/^(webfetch|websearch)/.test(t)) return 'web'
  if (/^(todowrite|toolsearch|exitplanmode|enterplanmode|askuserquestion)/.test(t)) return 'plan'
  if (/^(agent|task|workflow)/.test(t)) return 'crew'
  return 'podium'
}

export interface Sprite {
  id: string
  sid: string // owning session id ('' = orphan group)
  col: string
  big: boolean
  status: string
  slot: number // session number (1-based); 0 for bots/crowds
  l1: string
  l2: string
  count?: number // crowd sprites: how many agents it stands for
  x: number; y: number; tx: number; ty: number
  zone: string
  arriveFx: boolean
  done: boolean
  born: number
  // organic-walk state (ratified 2026-07-11). speed set at creation; the tween
  // fields are set by goTo on each retarget; crowds don't tween (they lerp-follow).
  speed: number // per-sprite walk-speed multiplier (~0.85–1.25)
  sx?: number; sy?: number // tween start
  cx?: number; cy?: number // bent bézier control point
  t?: number // tween progress 0..1 (>=1 = arrived)
  dur?: number // tween duration, seconds
  tweening?: boolean // mid organic walk
  trailTick?: number // PER-SPRITE walk-trail cadence counter (polish-2): decouples each
  // sprite's trail from co-walkers — a shared engine counter made even-count walkers
  // alternate parity, starving one trail and doubling the other.
  arrAt?: number // last arrival ts (drives the breathe window)
  // spawn-gate lifecycle (room-build-gate 2026-07-11). undefined = settled on the floor.
  phase?: 'entering' | 'departing'
  phaseT0?: number // entering: door-open ts. departing: dematerialize-start ts (set on gate arrival)
  enterTo?: { key: string } // station to route to once the entry walk-up completes
}

/* everything visual the engine wants drawn, as data — the shell renders it */
export type FxEvent =
  | { kind: 'emit'; x: number; y: number; col: string; n: number; speed: number; life: number; ring?: boolean; up?: boolean; g?: number; r?: number }
  | { kind: 'confetti'; x: number; y: number }
  | { kind: 'toast'; agent: LiveAgent }
  | { kind: 'shake'; amount: number }

export interface SyncResult {
  fx: FxEvent[]
  dirty: boolean
  hud: string // bots counter text ('' when roster empty)
}
export interface StreamResult {
  fx: FxEvent[]
  dirty: boolean
  hud: string | null // HUD activity line, null = leave as-is
}
export interface StepResult {
  moving: boolean
  fx: FxEvent[]
}

export class RoomEngine {
  readonly sessions = new Map<string, Sprite>() // session id -> orange sprite
  readonly bots = new Map<string, Sprite>() // drawn child id -> job sprite
  readonly crowds = new Map<string, Sprite>() // session id -> crowd sprite (+N)
  readonly glow: Record<string, number> = {} // zone key -> glowUntil ts (was mutable module state)
  private lastTool: Record<string, string> = {}
  private lastStatus = new Map<string, string>()
  private rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  private goTo(c: Sprite, key: string, now: number): void {
    const oldZone = c.zone
    c.zone = key
    c.arriveFx = true
    c.phase = undefined // routing to a station ends any gate entry/exit phase
    this.glow[key] = now + GLOW_MS
    // Fan-out is now PER-ZONE, not global-slot (polish-1 HIGH). goTo re-lays the whole
    // occupancy of the target zone (and re-closes the gap in the zone the sprite left) so
    // every body + its labels stay inside [z.x, z.x+z.w]; a lone occupant sits centred.
    // The layout starts each moved sprite on the ratified organic walk from where it stands.
    if (c.big) {
      this.fanSessions(key)
      if (oldZone && oldZone !== key) this.fanSessions(oldZone)
    } else {
      this.packBots(key)
      if (oldZone && oldZone !== key) this.packBots(oldZone)
    }
  }

  /** Lay out every session sprite currently in `key` as a centred row that FITS the bench:
   * bucket by zone, order by session slot, clamp the gap to `min(5.6,(w−2·bodyR)/(n−1))` so
   * the outermost body edge lands on the bench wall — never outside it. A session alone in a
   * zone sits dead-centre. Only sprites whose target actually moved get re-walked. */
  private fanSessions(key: string): void {
    const z = ZONES[key] || ZONES.podium
    const p = center(z)
    const peers: Sprite[] = []
    for (const s of this.sessions.values()) if (s.zone === key && s.phase !== 'departing') peers.push(s)
    if (!peers.length) return
    peers.sort((a, b) => a.slot - b.slot || a.sid.localeCompare(b.sid))
    const n = peers.length
    const span = n > 1 ? Math.min(5.6, Math.max(0, (z.w - 2 * SESS_BODY) / (n - 1))) : 0
    peers.forEach((s, i) => {
      const nx = p.x + (i - (n - 1) / 2) * span
      const ny = p.y + 1.2
      if (Math.abs(nx - s.tx) > 1e-4 || Math.abs(ny - s.ty) > 1e-4) { s.tx = nx; s.ty = ny; this.startWalk(s) }
    })
  }

  /** Deterministic packed grid for the bots in `key` (ordered by id — stable, no rng pileup):
   * cells fit inside the bench below the label band, bodies clamped to [z.x,z.x+z.w]×[…]. The
   * bench's per-zone "+N" chip (if any) rides the SAME grid as the last item, so the overflow
   * counter sits flush with the bodies it stands for. syncRoster caps the drawn bots per zone
   * at zoneBotCap(), so item count ≤ cols×rows → `rows` here never exceeds the bench height. */
  private packBots(key: string): void {
    const z = ZONES[key] || ZONES.podium
    const peers: Sprite[] = []
    for (const b of this.bots.values()) if (b.zone === key && b.phase !== 'departing') peers.push(b)
    peers.sort((a, b) => a.id.localeCompare(b.id))
    const zc = this.crowds.get('zone:' + key) // per-zone +N chip shares the grid, laid out last
    const n = peers.length + (zc ? 1 : 0)
    if (!n) return
    const { padX, padTop, usableW, usableH, maxCols } = benchGrid(z)
    const cols = Math.min(n, maxCols)
    const rows = Math.ceil(n / cols)
    const place = (b: Sprite, i: number, tween: boolean): void => {
      const col = i % cols, row = Math.floor(i / cols)
      const nx = z.x + padX + (col + 0.5) * (usableW / cols)
      const ny = z.y + padTop + (row + 0.5) * (usableH / rows)
      if (Math.abs(nx - b.tx) > 1e-4 || Math.abs(ny - b.ty) > 1e-4) { b.tx = nx; b.ty = ny; if (tween) this.startWalk(b) }
    }
    peers.forEach((b, i) => place(b, i, true))
    if (zc) place(zc, peers.length, false) // the +N chip lerp-follows (no organic-walk tween)
  }

  /** Organic-walk tween to the sprite's current tx/ty from where it stands NOW (survives
   * mid-walk retarget — curves from its current spot, never snaps back to a spawn point),
   * bent control point perpendicular to the path, distance-scaled duration / per-sprite
   * speed. Pure kinematics: no zone/glow/arriveFx (that stays goTo's job). */
  private startWalk(c: Sprite): void {
    c.sx = c.x; c.sy = c.y; c.t = 0; c.tweening = true
    const dist = Math.hypot(c.tx - c.sx, c.ty - c.sy)
    c.dur = Math.max(0.35, dist / 34) / c.speed
    const mx = (c.sx + c.tx) / 2, my = (c.sy + c.ty) / 2
    const nx = -(c.ty - c.sy), ny = c.tx - c.sx, nl = Math.hypot(nx, ny) || 1
    const bend = (this.rng() - 0.5) * dist * 0.5
    c.cx = mx + (nx / nl) * bend; c.cy = my + (ny / nl) * bend
  }

  /** Place a freshly-created sprite at the bottom-wall gate mouth in the `entering` phase:
   * it fades in + walks up ENTRY_RISE units (step()), then routes to `key` via the organic
   * walk. Simultaneous spawns lateral-stagger across the mouth so bursts don't stack. */
  private enterAtGate(c: Sprite, key: string, now: number): void {
    let entering = 0
    for (const s of this.sessions.values()) if (s.phase === 'entering') entering++
    for (const s of this.bots.values()) if (s.phase === 'entering') entering++
    // symmetric mouth stagger: a lone/first arrival lands dead-centre (offset 0), the next two
    // simultaneous spawns flank it at ∓GATE_STAGGER — was 0-based ((n%3)-1) which pushed a solo
    // arrival off-centre to x−4 (code-review nit).
    const gx = GATE_X + [0, -1, 1][entering % 3] * GATE_STAGGER
    c.x = gx; c.y = GATE_Y; c.tx = gx; c.ty = GATE_Y - ENTRY_RISE
    c.zone = ''
    c.arriveFx = false
    c.phase = 'entering'; c.phaseT0 = now; c.enterTo = { key }
  }

  /** Begin the ratified exit: organic-walk back to the gate mouth, then dematerialize —
   * step() starts the EXIT_MS timer on arrival and removes the sprite when it elapses.
   * Replaces the old confetti-pop-in-place. */
  private startDeparting(c: Sprite): void {
    c.phase = 'departing'; c.phaseT0 = undefined; c.enterTo = undefined
    c.arriveFx = false
    c.tx = GATE_X; c.ty = GATE_Y
    this.startWalk(c)
  }

  /** Reconcile the polled roster into sprite state. Sprites SURVIVE: an id
   * already known keeps its position/walk; only real joins/leaves change the
   * floor. Returns fx to render + whether a redraw is owed. */
  syncRoster(roster: LiveAgent[], now: number): SyncResult {
    const fx: FxEvent[] = []
    let dirty = false
    const sess = roster.filter((a) => a.kind === 'session')
    // v0.1 kid whitelist: swarm members only (subagent + workflow). Any other kind
    // (MC's crew / job / harness) is out of scope for claude-room and dropped here.
    const kids = roster.filter((a) => a.kind === 'subagent' || a.kind === 'workflow')
    const order = sess.map((s) => s.session).sort()
    const idxOf = new Map(order.map((sid, i) => [sid, i]))

    // ---- session sprites (orange Claude, one per session) ----
    const seenS = new Set<string>()
    for (const a of sess) {
      seenS.add(a.session)
      const i = idxOf.get(a.session) ?? 0
      const tool = a.tool || ''
      let c = this.sessions.get(a.session)
      if (!c) {
        c = { id: a.id, sid: a.session, col: CLAUDE_ORANGE, big: true, status: a.status, slot: i + 1, l1: trunc(a.project || a.name || 'claude', 16), l2: a.model || '', x: GATE_X, y: GATE_Y, tx: GATE_X, ty: GATE_Y, zone: '', arriveFx: false, done: false, born: now, speed: 0.85 + this.rng() * 0.4 }
        this.enterAtGate(c, zoneForTool(tool), now) // enter through the bottom-wall gate
        this.sessions.set(a.session, c)
        this.lastTool[a.session] = tool
        dirty = true
      } else {
        if (c.phase === 'departing') { c.phaseT0 = undefined; this.goTo(c, zoneForTool(tool), now); dirty = true } // flap: an exiting session came back — route it home
        if (c.status !== a.status) dirty = true // live<->done flips the idle dim
        c.status = a.status
        c.slot = i + 1
        c.l1 = trunc(a.project || a.name || 'claude', 16)
        c.l2 = a.model || ''
        if (tool !== this.lastTool[a.session]) { this.lastTool[a.session] = tool; this.goTo(c, zoneForTool(tool), now); dirty = true } // '' -> podium: idle sprite walks home (PR #5 review)
      }
    }
    // a session that left the roster walks out through the gate + dematerializes (step()
    // removes it once the exit completes) — no abrupt vanish. lastTool is freed now.
    for (const sid of [...this.sessions.keys()]) if (!seenS.has(sid)) { const c = this.sessions.get(sid)!; if (c.phase !== 'departing') { this.startDeparting(c); delete this.lastTool[sid]; dirty = true } }

    // ---- toast detection over EVERY child (drawn or crowd), then grouping BY HOME BENCH ----
    // (room-polish-crowd-saturation 2026-07-12): overflow is per-ZONE now, not per-session, so
    // children group by their job's home bench — a bench shows the bodies that fit + one +N.
    const rosterIds = new Set<string>()
    const byZone = new Map<string, LiveAgent[]>()
    for (const a of kids) {
      rosterIds.add(a.id)
      const prev = this.lastStatus.get(a.id)
      if (prev === undefined) {
        this.lastStatus.set(a.id, a.status) // first sight: record silently (no toast replay on mount)
      } else if (prev === 'live' && a.status !== 'live') {
        this.lastStatus.set(a.id, a.status)
        fx.push({ kind: 'toast', agent: a }) // honest even for crowd members that never got a sprite
        const b = this.bots.get(a.id)
        if (b) {
          if (a.status === 'failed') { fx.push({ kind: 'shake', amount: 4 }, { kind: 'emit', x: b.x, y: b.y, col: '#ff6b7d', n: 16, speed: 0.12, life: 900 }) }
          else fx.push({ kind: 'confetti', x: b.x, y: b.y })
        }
        dirty = true
      } else if (prev !== a.status) this.lastStatus.set(a.id, a.status)
      const home = jobOf(a).home
      if (!byZone.has(home)) byZone.set(home, [])
      byZone.get(home)!.push(a)
    }
    for (const id of [...this.lastStatus.keys()]) if (!rosterIds.has(id)) this.lastStatus.delete(id)

    // ---- per-ZONE pick: each bench shows the bodies that legibly fit (zoneBotCap, live-first)
    // and folds the rest into ONE honest per-zone "+N" chip parked in that bench. Replaces the
    // old per-session +N. When a bench overflows
    // it reserves the last cell for the chip, so the chip stands in the grid with the bodies. ----
    const seenB = new Set<string>()
    const seenZC = new Set<string>()
    for (const [zoneKey, group] of byZone) {
      const sorted = [...group].sort((a, b) => (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1) || a.id.localeCompare(b.id))
      const cap = zoneBotCap(zoneKey)
      const overflowing = sorted.length > cap
      const shownN = overflowing ? cap - 1 : sorted.length // reserve one cell for the +N chip
      const hidden = sorted.length - shownN
      for (let i = 0; i < shownN; i++) {
        const a = sorted[i]
        seenB.add(a.id)
        const jl = jobOf(a)
        let b = this.bots.get(a.id)
        if (!b) {
          b = { id: a.id, sid: a.session || '', col: jl.col, big: false, status: a.status, slot: 0, l1: trunc(a.name || a.job || 'agent', 15), l2: a.model || '', x: GATE_X, y: GATE_Y, tx: GATE_X, ty: GATE_Y, zone: '', arriveFx: false, done: a.status !== 'live', born: now, speed: 0.85 + this.rng() * 0.4 }
          // gate entry: every child enters the SAME bottom-wall door as a
          // session — kind stays legible by sprite colour. The portal ring + parent dispatch
          // beam were retired with the podium/portal materialization (keep it simple).
          this.enterAtGate(b, zoneKey, now)
          this.bots.set(a.id, b)
          dirty = true
        } else {
          if (b.phase === 'departing') { b.phaseT0 = undefined; this.goTo(b, zoneKey, now); dirty = true } // flap: an exiting child came back
          else if (b.phase === undefined && b.zone && b.zone !== zoneKey) { this.goTo(b, zoneKey, now); dirty = true } // job reclassified → new home bench
          b.l2 = a.model || ''
          if (b.status !== a.status) { b.status = a.status; b.done = a.status !== 'live'; dirty = true }
        }
      }
      // ---- per-zone +N chip: parked in the bench, laid out by packBots as the grid's last cell ----
      const zcKey = 'zone:' + zoneKey
      let cr = this.crowds.get(zcKey)
      if (hidden > 0) {
        seenZC.add(zcKey)
        if (!cr) {
          const c0 = center(ZONES[zoneKey] || ZONES.podium)
          cr = { id: zcKey, sid: '', col: CROWD_COL, big: false, status: 'live', slot: 0, l1: '+' + hidden, l2: '', count: hidden, x: c0.x, y: c0.y, tx: c0.x, ty: c0.y, zone: zoneKey, arriveFx: false, done: false, born: now, speed: 1 }
          this.crowds.set(zcKey, cr)
          dirty = true
        } else if (cr.count !== hidden) { cr.count = hidden; cr.l1 = '+' + hidden; dirty = true }
      }
      // lay out the bench's arrived bots + its +N chip together (positions the chip, re-tightens
      // the grid when a body demotes into the chip). Entering bots (zone '') join on gate arrival.
      this.packBots(zoneKey)
    }
    // retire departed sprites. True roster exit → walk out through the gate + dematerialize
    // (ratified exit, replaces confetti-pop-in-place; step() removes it when done). A body that
    // demoted into a +N (still on the roster, just lost its cell to the bench cap) never left
    // the room — silent remove.
    for (const id of [...this.bots.keys()]) {
      if (!seenB.has(id)) {
        const b = this.bots.get(id)!
        if (rosterIds.has(id)) { this.bots.delete(id); if (b.zone) this.packBots(b.zone); dirty = true } // demotion: silent remove, re-tighten its bench
        else if (b.phase !== 'departing') { this.startDeparting(b); dirty = true } // exit via the gate
      }
    }
    for (const k of [...this.crowds.keys()]) if (!seenZC.has(k)) { const zk = this.crowds.get(k)!.zone; this.crowds.delete(k); this.packBots(zk); dirty = true }

    // HUD counter (honest: everything is on the floor now, sprites or crowd)
    const liveN = roster.filter((a) => a.status === 'live').length
    const hud = roster.length ? `${liveN} live · ${sess.length} sessions` : ''
    return { fx, dirty, hud }
  }

  /** Apply one SSE hook event (already JSON-parsed by the shell). */
  applyStreamEvent(e: { event?: string; tool?: string; detail?: string; session?: string }, now: number): StreamResult {
    const fx: FxEvent[] = []
    let dirty = false
    let hud: string | null = null
    if (!e || !e.event) return { fx, dirty, hud }
    if (/\b(error|failed|exception|traceback)\b/i.test(e.detail || '')) { fx.push({ kind: 'shake', amount: 5 }); dirty = true }
    const sid = (e.session || '').slice(0, 8)
    const s = this.sessions.get(sid)
    const c = s && s.phase !== 'departing' ? s : undefined // a session on its way out the gate isn't re-routed
    if (e.event === 'UserPromptSubmit') {
      if (c) { this.lastTool[sid] = ''; this.goTo(c, 'podium', now); dirty = true }
      return { fx, dirty, hud: 'You prompted · ' + (sid || '—') }
    }
    if (e.event !== 'PreToolUse') return { fx, dirty, hud }
    const key = zoneForTool(e.tool)
    if (c) {
      this.lastTool[sid] = e.tool || ''
      this.goTo(c, key, now)
      // work sparks only once the worker is AT the bench — a zone-changing event starts a
      // walk (tweening), and sparking the destination before the sprite arrives reads as a
      // glitch (polish-3). Arrival already pops via arriveFx; sparks resume on the next
      // tool event after landing.
      if (!c.tweening) {
        const zc = center(ZONES[key] || ZONES.podium)
        fx.push({ kind: 'emit', x: zc.x, y: zc.y - 2, col: (ZONES[key] || ZONES.podium).line, n: 6, speed: 0.08, life: 600, up: true })
      }
      dirty = true
    } else { this.glow[key] = now + GLOW_MS; dirty = true }
    const d = (e.detail || '').slice(0, 80)
    hud = `${e.tool || ''}${d ? ' · ' + d : ''}`
    return { fx, dirty, hud }
  }

  /** Advance every sprite one kinematic frame. Sessions + bots travel the ratified
   * organic walk (eased bézier along a bent waypoint); crowds lerp-follow their moving
   * parent anchor. Returns whether anything still needs drawing + landing/trail fx.
   *
   * Zero-idle law: a fully-settled floor returns {moving:false, fx:[]} so the shell draws
   * nothing — EXCEPT for the bounded breathe window after each arrival (moving stays true
   * for BOB_MS so the shell can render the bob), which then elapses back to zero frames.
   *
   * `dtMs` = ms since last frame (from the shell's rAF); `now` = Date.now(), passed in. */
  step(dtMs: number, now: number): StepResult {
    const fx: FxEvent[] = []
    let moving = false
    const dt = dtMs / 1000
    // advance one sprite (sessions + bots). Returns true when it has fully dematerialized
    // at the gate and must be removed by the caller.
    const walk = (c: Sprite): boolean => {
      // gate entry: fade-in + straight walk-up off the mouth (ENTRY_MS), then hand off to
      // the ratified organic walk toward its station.
      if (c.phase === 'entering') {
        const p = clamp01((now - (c.phaseT0 ?? now)) / ENTRY_MS)
        c.y = GATE_Y - ENTRY_RISE * easeOutCubic(p)
        c.x = c.tx // hold the mouth column while rising
        moving = true
        if (p >= 1) { const to = c.enterTo; c.enterTo = undefined; if (to) this.goTo(c, to.key, now); else c.phase = undefined }
        return false
      }
      if (c.tweening) {
        c.t = (c.t ?? 0) + dt / (c.dur || 0.35)
        const p = Math.min(1, c.t)
        const e = easeOutBack(p)
        c.x = qbez(c.sx ?? c.x, c.cx ?? c.x, c.tx, e)
        c.y = qbez(c.sy ?? c.y, c.cy ?? c.y, c.ty, e)
        // walk trail — PER-SPRITE cadence (polish-2): each sprite counts its own frames so
        // concurrent even-count walkers no longer split into one dense + one bald trail.
        // Given real velocity + a touch of gravity so it drifts as a wake, not static dots.
        c.trailTick = (c.trailTick ?? 0) + 1
        // g halved 0.003→0.0015 when the shell went dt-scaled gravity (polish-3): at the
        // ~30fps cap dt·0.06 ≈ 2, so 0.0015 lands the same per-frame pull polish-2 tuned.
        if (c.trailTick % 2 === 0) fx.push({ kind: 'emit', x: c.x, y: c.y + 1.0, col: c.col, n: 1, speed: 0.06, life: 420, g: 0.0015 })
        if (p >= 1) {
          c.x = c.tx; c.y = c.ty; c.tweening = false
          if (c.phase === 'departing') c.phaseT0 = now // arrived at the gate: start dematerialize (no breathe, no landing pop)
          else {
            c.arrAt = now
            if (c.arriveFx) { c.arriveFx = false; fx.push({ kind: 'emit', x: c.x, y: c.y, col: c.col, n: 8, speed: 0.1, life: 500 }) } // landing pop
          }
        }
        moving = true
        return false
      }
      // departing, arrived at the gate mouth: dematerialize over EXIT_MS, then remove
      if (c.phase === 'departing' && c.phaseT0 !== undefined) {
        moving = true
        return now - c.phaseT0 >= EXIT_MS
      }
      // settled: bounded breathe window keeps the shell awake to draw the arrival bob
      if (c.arrAt !== undefined && now - c.arrAt < BOB_MS) moving = true
      return false
    }
    // crowd follow: their anchor tracks a moving parent, so a straight ease-toward is right
    const follow = (c: Sprite): void => {
      const dx = c.tx - c.x, dy = c.ty - c.y
      if (Math.abs(dx) + Math.abs(dy) < 0.05) { c.x = c.tx; c.y = c.ty; return }
      c.x += dx * 0.12; c.y += dy * 0.12
      moving = true
    }
    for (const [id, c] of [...this.sessions]) if (walk(c)) this.sessions.delete(id)
    for (const [id, b] of [...this.bots]) if (walk(b)) this.bots.delete(id)
    for (const c of this.crowds.values()) follow(c)
    return { moving, fx }
  }

  /** True while any zone glow is still burning (shell keeps animating). */
  glowActive(now: number): boolean {
    for (const k of ZONE_KEYS) if (this.glow[k] && now < this.glow[k]) return true
    return false
  }
}
