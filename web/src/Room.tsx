import { useEffect, useRef } from 'react'
import { useApi } from './api'
import { RoomEngine, ZONES, ZONE_KEYS, zoneForTool, BOB_MS, ENTRY_MS, EXIT_MS, GATE_X } from './roomEngine'
import type { LiveAgent, FxEvent, Sprite, Zone } from './roomEngine'
import './room.css'

/* ------------------------------------------------------------------ *
 * THE ROOM — pixel diorama. Render SHELL only (canvas, particles, DOM
 * toasts, SSE socket, focus): all sprite state + roster reconcile lives
 * in roomEngine.ts (extracted 2026-07-11, room-engine-lifecycle-fix).
 * The engine mounts ONCE and survives roster churn — the old idKey
 * re-init (every membership change respawned the whole floor) is gone.
 * Zero-idle law intact: dirty-flag rAF, ~30fps cap; a settled, hidden
 * or empty room draws ZERO frames.
 *
 * Consumes GET /api/live-agents (3s poll) +
 * EventSource /api/stream, same-origin (the standalone watcher serves
 * both plus this page's built dist/).
 * ------------------------------------------------------------------ */

interface LiveAgents {
  agents: LiveAgent[]
  live?: number
  done_recent?: number
  ts?: number
}
const FALLBACK: LiveAgents = { agents: [], live: 0, done_recent: 0 }

const IDLE_ALPHA = 0.55 // parked session sprite opacity (grill: dim idle)
const GHOST_ALPHA = 0.25 // unfocused-session opacity while a focus is active

interface Particle { x: number; y: number; vx: number; vy: number; g: number; col: string; life: number; t: number; r: number; rect?: boolean }
// (Beam removed, polish-3: the parent→child dispatch beam was retired with the spawn gate —
// the engine never emits kind:'beam' anymore, so the shell's beam pipeline was dead code.)

function FloorPlan({ agents }: { agents: LiveAgent[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hudRef = useRef<HTMLSpanElement | null>(null)
  const dotRef = useRef<HTMLSpanElement | null>(null)
  const botsRef = useRef<HTMLSpanElement | null>(null)
  const towerRef = useRef<HTMLDivElement | null>(null)
  const agentsRef = useRef<LiveAgent[]>(agents)
  agentsRef.current = agents

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2) // polish-1: crisp sprite text on 4K/Retina

    const engine = new RoomEngine()
    let focus: string | null = null
    const timers: ReturnType<typeof setTimeout>[] = []

    let S = 1
    let OX = 0
    let OY = 0
    const sx = (v: number) => OX + v * S
    const sy = (v: number) => OY + v * S
    let dirty = true
    // offscreen background layer state (polish-5) — declared before the first size() call,
    // which stamps bgKey stale; bakeBg itself lives further down with the paint helpers
    let bg: HTMLCanvasElement | null = null
    let bgKey = ''
    // per-bench occupancy counts, refreshed once per draw() — drive label suppression at
    // density (room-polish-crowd-saturation). Session vs bot kept separate (different thresholds).
    const sessN = new Map<string, number>()
    const botN = new Map<string, number>()

    function size() {
      const w = cv!.clientWidth || 900
      const h = cv!.clientHeight || 560
      cv!.width = Math.max(1, Math.round(w * dpr))
      cv!.height = Math.max(1, Math.round(h * dpr))
      S = Math.min((w * dpr) / 104, (h * dpr) / 66)
      OX = (w * dpr - 100 * S) / 2
      OY = (h * dpr - 62 * S) / 2
      bgKey = '\0stale' // resize invalidates the baked background layer (polish-5)
      dirty = true
    }
    size()

    const FX: { parts: Particle[]; shake: number } = { parts: [], shake: 0 }
    const CONFETTI = ['#46e6a4', '#ff6b7d', '#38e8ff', '#ffc25a', '#a878ff', '#e7c66a']

    // NOTE (polish-3): no per-emitter particle cap here — the 260 cap is enforced at ONE
    // choke-point, per frame, in the rAF integration loop, so no emit path can bypass it.
    function emit(x: number, y: number, col: string, n: number, speed: number, life: number, opt?: { ring?: boolean; up?: boolean; g?: number; r?: number }) {
      opt = opt || {}
      for (let i = 0; i < n; i++) {
        const a = opt.ring ? (i / n) * Math.PI * 2 : Math.random() * Math.PI * 2
        const v = opt.ring ? speed : speed * (0.4 + Math.random() * 0.6) // rings stay rings: uniform radial speed
        FX.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opt.up ? 0.05 : 0), g: opt.g || 0, col, life, t: life, r: opt.r || 0.45 })
      }
    }
    function confetti(x: number, y: number) {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 0.1 + Math.random() * 0.2
        // g tuned for the dt-scaled integrator (~2.5× the old per-frame pull): confetti
        // crests just above the sprite then RAINS, instead of drifting off like dust (polish-3)
        FX.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.16, g: 0.014, col: CONFETTI[i % CONFETTI.length], life: 1300, t: 1300, r: 0.5 + Math.random() * 0.4, rect: true })
      }
    }

    /* ---- toast tower (DOM, focus-aware) ---- */
    // self-pruning timer: the id leaves `timers` when it fires, so the array
    // only ever holds PENDING timers (verifier 2026-07-05 leak fix preserved)
    function schedule(fn: () => void, ms: number) {
      const id = setTimeout(() => {
        const i = timers.indexOf(id)
        if (i >= 0) timers.splice(i, 1)
        fn()
      }, ms)
      timers.push(id)
    }
    function refreshTowerFocus() {
      const tower = towerRef.current
      if (!tower) return
      for (const el of Array.from(tower.children) as HTMLElement[]) {
        el.style.opacity = focus && el.dataset.sid !== focus ? String(GHOST_ALPHA) : ''
      }
    }
    function towerSay(a: LiveAgent) {
      const tower = towerRef.current
      if (!tower) return
      const ok = a.status !== 'failed'
      const div = document.createElement('div')
      div.className = 'rm-toast ' + (ok ? 'ok' : 'fail')
      div.dataset.sid = a.session || ''
      div.textContent = `${ok ? '✅' : '❌'} ${(a.name || a.job || 'agent').slice(0, 18)}${a.model ? ' · ' + a.model : ''} · ${(a.detail || '').slice(0, 48)}`
      if (focus && (a.session || '') !== focus) div.style.opacity = String(GHOST_ALPHA)
      tower.prepend(div)
      while (tower.children.length > 4) tower.removeChild(tower.lastChild!)
      schedule(() => {
        div.classList.add('fade')
        schedule(() => div.remove(), 1600)
      }, 25000)
    }

    /* every FxEvent the engine returns lands here */
    function playFx(events: FxEvent[]) {
      for (const f of events) {
        if (f.kind === 'emit') emit(f.x, f.y, f.col, f.n, f.speed, f.life, f)
        else if (f.kind === 'confetti') confetti(f.x, f.y)
        else if (f.kind === 'toast') towerSay(f.agent)
        else if (f.kind === 'shake') FX.shake = f.amount
      }
      if (events.length) dirty = true
    }

    // takes the target context so the same path helper draws into the offscreen
    // background layer and the live canvas alike (polish-5)
    function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.roundRect(x, y, w, h, r) }

    // canvas font strings were rebuilt via template literals on every drawChip/drawZone call
    // (thousands/min on a busy floor); dpr is fixed at mount, so build each once (polish-5)
    const FONT = {
      zLabel: `600 ${10 * dpr}px ui-monospace, Consolas, monospace`,
      zIcon: `${11 * dpr}px system-ui`,
      crowd: `700 ${8.5 * dpr}px ui-monospace, Consolas, monospace`,
      done: `${9 * dpr}px system-ui`,
      slot: `700 ${8.5 * dpr}px ui-monospace, Consolas, monospace`,
      l1Big: `700 ${9.5 * dpr}px Inter, system-ui, sans-serif`,
      l1Small: `600 ${8 * dpr}px Inter, system-ui, sans-serif`,
      l2: `${7 * dpr}px ui-monospace, Consolas, monospace`,
      gate: `600 ${7.5 * dpr}px ui-monospace, Consolas, monospace`,
    }

    /* focus alpha for anything owned by a session */
    function alphaFor(c: Sprite): number {
      let a = 1
      if (c.big && c.status !== 'live') a *= IDLE_ALPHA // grill: dim idle sessions
      if (focus && c.sid !== focus) a *= GHOST_ALPHA
      return a
    }

    // lighten a #rrggbb by `amt` per channel (for the static bench-surface gradient)
    function lighten(hex: string, amt: number): string {
      const n = parseInt(hex.slice(1), 16)
      const r = Math.min(255, (n >> 16) + amt)
      const gg = Math.min(255, ((n >> 8) & 255) + amt)
      const b = Math.min(255, (n & 255) + amt)
      return `rgb(${r},${gg},${b})`
    }

    // static bench painting, split from the live glow so it can bake into the offscreen
    // background layer (polish-5). Occupancy alpha is part of the bake — the bake key
    // includes the occupied-set, so a roster move rebakes (rare) instead of redrawing
    // every bench every frame (constant).
    function paintZone(g: CanvasRenderingContext2D, z: Zone, occupied: boolean) {
      g.save()
      if (!occupied) g.globalAlpha = 0.6 // recede empty benches so occupied ones read (polish-4)
      // subtle top→base surface gradient gives each bench depth (static, one draw)
      const grad = g.createLinearGradient(0, sy(z.y), 0, sy(z.y + z.h))
      grad.addColorStop(0, lighten(z.col, 20))
      grad.addColorStop(1, z.col)
      rrect(g, sx(z.x), sy(z.y), z.w * S, z.h * S, 6 * dpr)
      g.fillStyle = grad; g.fill()
      g.lineWidth = 1.4 * dpr; g.strokeStyle = z.line; g.stroke()
      if (z.label) {
        g.fillStyle = 'rgba(239,233,220,.62)'
        g.font = FONT.zLabel
        g.textAlign = 'left'
        g.fillText(z.label, sx(z.x) + 6 * dpr, sy(z.y) + 13 * dpr)
        g.font = FONT.zIcon
        g.textAlign = 'right'
        g.fillText(z.ic, sx(z.x + z.w) - 6 * dpr, sy(z.y) + 14 * dpr)
      }
      g.restore()
    }
    // live glow stroke over the baked bench — only runs for zones actually glowing.
    // NOTE: relies on every z.line being OPAQUE — the 2.2dpr glow stroke fully paints over
    // the baked 1.4dpr bench stroke on the same path; an rgba() line with alpha<1 would
    // composite a visibly darker inner band here.
    function glowStroke(z: Zone, until: number, now: number) {
      const kk = (until - now) / 1500
      ctx!.save()
      ctx!.shadowColor = z.line
      ctx!.shadowBlur = (10 * kk + 4 + 3 * Math.sin(now / 110)) * dpr
      rrect(ctx!, sx(z.x), sy(z.y), z.w * S, z.h * S, 6 * dpr)
      ctx!.lineWidth = 2.2 * dpr; ctx!.strokeStyle = z.line; ctx!.stroke()
      ctx!.restore()
    }

    function drawBody(x: number, y: number, r: number, col: string) {
      rrect(ctx!, x - r, y - r, r * 2, r * 2, r * 0.45)
      ctx!.fillStyle = col; ctx!.fill()
      ctx!.lineWidth = 1.2 * dpr; ctx!.strokeStyle = 'rgba(0,0,0,.45)'; ctx!.stroke()
      ctx!.fillStyle = '#10131c'
      const er = r * 0.16
      const eo = r * 0.32
      ctx!.fillRect(x - eo - er, y - er * 1.6, er * 2, er * 3)
      ctx!.fillRect(x + eo - er, y - er * 1.6, er * 2, er * 3)
    }

    // labels give way when a bench is packed (room-polish-crowd-saturation): at high density
    // the name/model lines stack into spaghetti, so past a per-kind threshold they're dropped
    // (bodies stay) and a click-focus still reveals the focused sprite's label. Recomputed each
    // frame from the live occupancy; a normal floor is untouched.
    const LABEL_DENSE_SESS = 4 // >this many sessions sharing one bench → suppress their labels
    const LABEL_DENSE_BOTS = 4 // >this many bots sharing one bench → suppress their labels
    function labelHidden(c: Sprite): boolean {
      if (focus === c.sid) return false // the focused sprite always shows its label
      const n = c.big ? (sessN.get(c.zone) || 0) : (botN.get(c.zone) || 0)
      return c.big ? n > LABEL_DENSE_SESS : n > LABEL_DENSE_BOTS
    }

    function drawChip(c: Sprite, now: number) {
      ctx!.save()
      ctx!.globalAlpha = alphaFor(c)
      let x = sx(c.x)
      let y = sy(c.y)
      if (c.count !== undefined) {
        // crowd sprite: three tiny bodies in a row + honest +N above
        const r = 0.9 * S
        drawBody(x - r * 2.1, y, r, c.col)
        drawBody(x, y - r * 0.35, r, c.col)
        drawBody(x + r * 2.1, y, r, c.col)
        ctx!.fillStyle = '#efe9dc'
        ctx!.font = FONT.crowd
        ctx!.textAlign = 'center'
        ctx!.fillText(c.l1, x, y - r - 5 * dpr)
        ctx!.restore()
        return
      }
      // gate entry/exit cosmetics — fade + scale. The engine owns the phase + timing; the
      // shell only reads them (like the bob). A departing sprite fades only once it has
      // reached the mouth (phaseT0 set); while it walks there it draws normally.
      let pAlpha = 1, pScale = 1
      if (c.phase === 'entering' && c.phaseT0 !== undefined) {
        const p = Math.min(1, (now - c.phaseT0) / ENTRY_MS)
        pAlpha = 1 - Math.pow(1 - p, 3); pScale = 0.7 + 0.3 * p
      } else if (c.phase === 'departing' && c.phaseT0 !== undefined) {
        const p = Math.min(1, (now - c.phaseT0) / EXIT_MS)
        pAlpha = 1 - p; pScale = 1 - 0.3 * p
      }
      ctx!.globalAlpha = alphaFor(c) * pAlpha
      // breathe-on-arrival: a bounded settle bob for BOB_MS after a
      // sprite lands, decaying to zero. RENDER-space only — c.x/c.y stay put so the
      // click hit-test never jitters, and the engine's moving-window ends the frames.
      if (c.arrAt !== undefined && !c.tweening) {
        const t = (now - c.arrAt) / BOB_MS
        if (t >= 0 && t < 1) {
          // respiration, not a skid (polish-2): BOTH axes driven by sin starting at 0 so the
          // body never teleports sideways on landing (the old cos(0)=1 jumped x instantly);
          // eased (squared) decay envelope settles instead of cutting; vertical amplitude
          // tamed to a breath, x a subtle single lean at half the frequency. Render-space
          // only — c.x/c.y stay put so hit-testing never jitters.
          const env = (1 - t) * (1 - t)
          y -= Math.sin(t * Math.PI * 2) * 0.5 * S * env
          x += Math.sin(t * Math.PI) * 0.1 * S * env
        }
      }
      const r = (c.big ? 2.2 : 1.6) * S * pScale
      drawBody(x, y, r, c.col)
      if (c.done) {
        const okc = c.status === 'failed' ? '#ff6b7d' : '#46e6a4'
        rrect(ctx!, x - r, y - r, r * 2, r * 2, r * 0.45)
        ctx!.lineWidth = 2 * dpr; ctx!.strokeStyle = okc; ctx!.stroke()
        ctx!.font = FONT.done; ctx!.textAlign = 'center'
        ctx!.fillStyle = okc
        ctx!.fillText(c.status === 'failed' ? '✗' : '✓', x, y - r - 3 * dpr)
      }
      if (c.big) {
        // slot number on a small dark disc so it reads over any bench colour (polish-1:
        // legible-or-gone) instead of bare cream text lost against a light gradient
        const nx = x - r - 3 * dpr, ny = y - r - 1 * dpr
        ctx!.fillStyle = 'rgba(16,19,28,.78)'
        ctx!.beginPath(); ctx!.arc(nx, ny, 7 * dpr, 0, Math.PI * 2); ctx!.fill()
        ctx!.fillStyle = '#ffd9a8'
        ctx!.font = FONT.slot
        ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle'
        ctx!.fillText(String(c.slot), nx, ny)
        ctx!.textBaseline = 'alphabetic'
      }
      // labels give way when this bench is packed (room-polish-crowd-saturation) — bodies stay,
      // click-focus still reveals. A normal-density bench draws every label as before.
      const showLabel = !labelHidden(c)
      if (showLabel) {
        // bot names lifted to a light neutral (was low-contrast body colour on a dark floor);
        // sessions keep the cream label. polish-1 label-clutter pass. Names give way when the
        // bench is packed (crowd-saturation) — the model line below does NOT.
        ctx!.fillStyle = c.big ? '#efe9dc' : 'rgba(224,230,244,.9)'
        ctx!.font = c.big ? FONT.l1Big : FONT.l1Small
        ctx!.textAlign = 'center'
        ctx!.fillText(c.l1, x, y + r + 10 * dpr)
      }
      // model line: TRULY always visible under every sprite, dim — you should
      // read an agent's model (fable / opus-4.8 / sonnet-5) at a glance without clicking, even on
      // a label-suppressed dense bench. When the name is hidden it takes the name's slot (+10) so
      // it hugs the body instead of floating in an empty gap. Un-nested from labelHidden per the
      // code-review finding: the old placement dropped the model line with the name at density.
      if (c.l2) {
        ctx!.fillStyle = 'rgba(200,208,224,.55)'
        ctx!.font = FONT.l2
        ctx!.textAlign = 'center'
        ctx!.fillText(c.l2, x, y + r + (showLabel ? 19 : 10) * dpr)
      }
      ctx!.restore()
    }

    // ---- offscreen background layer (polish-5): grid + room border + all 8 benches
    // (fills, strokes, labels, occupancy alpha) baked once, blitted per frame with a single
    // drawImage. Rebakes only on resize (bg=null) or when the occupied-set changes.
    // Subsumes the "grid = ~36 stroke calls per frame" audit low. ----
    function bakeBg(occ: Set<string>) {
      if (!bg || bg.width !== cv!.width || bg.height !== cv!.height) {
        bg = document.createElement('canvas')
        bg.width = cv!.width; bg.height = cv!.height
      }
      const g = bg.getContext('2d')!
      g.clearRect(0, 0, bg.width, bg.height)
      // floor grid (dpr-scaled width so it holds up on hi-DPI, was a flat 1px)
      g.strokeStyle = 'rgba(110,130,180,.08)'; g.lineWidth = 1 * dpr
      const gs = 5 * S
      for (let gx = OX % gs; gx < bg.width; gx += gs) { g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, bg.height); g.stroke() }
      for (let gy = OY % gs; gy < bg.height; gy += gs) { g.beginPath(); g.moveTo(0, gy); g.lineTo(bg.width, gy); g.stroke() }
      // room border (neutral warm-grey, tuned to sit with the coordinated bench palette)
      rrect(g, sx(2), sy(2), 96 * S, 58 * S, 4 * dpr)
      g.lineWidth = 2 * dpr; g.strokeStyle = 'rgba(150,146,158,.32)'; g.stroke()
      for (const k of ZONE_KEYS) paintZone(g, ZONES[k], occ.has(k))
      bgKey = [...occ].sort().join(',')
    }

    // ---- spawn gate: ONE airlock door on the bottom wall (ratified, room-build-gate).
    // Opens — frame brightens + light spills onto the floor — while any sprite is entering
    // or dematerializing at the mouth; otherwise a dim static frame. Zero-idle: it only
    // animates during the bounded gate FX (a settled door is just the last dim frame). ----
    function gateActive(): boolean {
      const lit = (c: Sprite) => c.phase === 'entering' || (c.phase === 'departing' && c.phaseT0 !== undefined)
      for (const c of engine.sessions.values()) if (lit(c)) return true
      for (const b of engine.bots.values()) if (lit(b)) return true
      return false
    }
    function drawGate() {
      const gx = sx(GATE_X), gy = sy(62), wpx = 13 * S, on = gateActive()
      ctx!.save()
      // door frame set into the bottom wall
      ctx!.fillStyle = on ? '#3a2f16' : '#141826'
      ctx!.fillRect(gx - wpx / 2, gy - 2.4 * S, wpx, 2.4 * S)
      ctx!.lineWidth = 1.4 * dpr; ctx!.strokeStyle = on ? '#ffb050' : '#3a4468'
      ctx!.strokeRect(gx - wpx / 2, gy - 2.4 * S, wpx, 2.4 * S)
      // light spill onto the floor while open
      if (on) {
        const grd = ctx!.createLinearGradient(0, gy - 2.4 * S, 0, gy - 12 * S)
        grd.addColorStop(0, 'rgba(255,176,80,0.34)'); grd.addColorStop(1, 'rgba(255,176,80,0)')
        ctx!.fillStyle = grd; ctx!.beginPath()
        ctx!.moveTo(gx - wpx / 2, gy - 2.4 * S); ctx!.lineTo(gx + wpx / 2, gy - 2.4 * S)
        ctx!.lineTo(gx + wpx * 0.9, gy - 12 * S); ctx!.lineTo(gx - wpx * 0.9, gy - 12 * S); ctx!.closePath(); ctx!.fill()
      }
      ctx!.fillStyle = on ? '#ffcf9b' : '#5b6588'
      ctx!.font = FONT.gate
      ctx!.textAlign = 'center'; ctx!.fillText('▲ GATE', gx, gy - 0.7 * S)
      ctx!.restore()
    }

    // one `now` per frame, threaded from frame() — draw and its helpers no longer each
    // call Date.now() (polish-5 render/sim seam)
    function draw(now: number) {
      const w = cv!.width
      const h = cv!.height
      ctx!.clearRect(0, 0, w, h)
      ctx!.save()
      // shake read-only here — the decay moved to the frame step so draw() no longer
      // mutates sim state (polish-5 render/sim seam; amplitude/decay tuning is polish-3)
      if (FX.shake > 0.1) {
        ctx!.translate((Math.random() - 0.5) * FX.shake * dpr, (Math.random() - 0.5) * FX.shake * dpr)
      }
      // occupied benches read at full strength; empty ones recede — occupancy is part of
      // the baked background key, so a bench change rebakes once instead of drawing
      // grid + border + 8 zones every frame (polish-5)
      // occ from sessions+bots only. A per-zone +N chip does NOT mark its bench occupied —
      // safe today because every bot home bench has cap ≥ 2 (min = web/3), so a bench with a
      // chip always shows ≥1 body too. Only a cap-1 bench (skills) could be chip-only, and no
      // jobOf home routes there. If a future job homes to a cap-1 bench, add chips to occ here.
      const occ = new Set<string>()
      sessN.clear(); botN.clear()
      for (const c of engine.sessions.values()) if (c.zone) { occ.add(c.zone); sessN.set(c.zone, (sessN.get(c.zone) || 0) + 1) }
      for (const b of engine.bots.values()) if (b.zone) { occ.add(b.zone); botN.set(b.zone, (botN.get(b.zone) || 0) + 1) }
      if (!bg || bgKey !== [...occ].sort().join(',')) bakeBg(occ)
      ctx!.drawImage(bg!, 0, 0)
      // live glow strokes over the baked benches — only for zones actually glowing
      for (const k of ZONE_KEYS) {
        const until = engine.glow[k]
        if (until && now < until) glowStroke(ZONES[k], until, now)
      }
      drawGate() // the bottom-wall spawn gate, under the sprites so the light-spill sits behind them
      for (const c of engine.crowds.values()) drawChip(c, now)
      for (const b of engine.bots.values()) drawChip(b, now)
      for (const c of engine.sessions.values()) drawChip(c, now)
      // particles on top (alpha scoped by save/restore, not manual reset — polish-5)
      ctx!.save()
      for (const p of FX.parts) {
        const k = p.t / p.life
        if (k < 0.05) continue // dying this frame: skipping beats a sub-pixel shimmer (polish-3)
        ctx!.globalAlpha = k; ctx!.fillStyle = p.col
        const pr = Math.max(p.r * S * (p.rect ? 1 : k), 0.8 * dpr) // dpr-scaled floor (dots draw at pr/2, so min dot radius = 0.4·dpr — constant, so no end-of-life shimmer)
        if (p.rect) ctx!.fillRect(sx(p.x) - pr / 2, sy(p.y) - pr / 2, pr, pr * 0.62)
        else { ctx!.beginPath(); ctx!.arc(sx(p.x), sy(p.y), pr * 0.5, 0, Math.PI * 2); ctx!.fill() }
      }
      ctx!.restore()
      ctx!.restore()
    }

    // ---- click-to-focus: hit-test the orange Claudes; floor click clears ----
    function onPointerDown(e: PointerEvent) {
      if (e.target !== cv) return
      const dx = (e.offsetX * dpr - OX) / S
      const dy = (e.offsetY * dpr - OY) / S
      let hit: string | null = null
      for (const [sid, c] of engine.sessions) {
        const r = 2.2 + 0.8 // body + touch pad, design units
        if (Math.abs(dx - c.x) <= r && Math.abs(dy - c.y) <= r) { hit = sid; break }
      }
      focus = hit === focus ? null : hit
      refreshTowerFocus()
      if (focus) { const s = engine.sessions.get(focus); setHud(`focus · ${s?.l1 || focus} — click floor to clear`) }
      else setHud('watching the whole floor')
      dirty = true
    }

    // ---- SSE: instant per-session walk + work sparks (socket owned by the
    // shell, opened ONCE per mount — roster churn never reconnects it) ----
    let stopped = false
    let es: EventSource | null = null
    let tries = 0
    let reconnect: ReturnType<typeof setTimeout> | null = null
    const clearReconnect = () => { if (reconnect) { clearTimeout(reconnect); reconnect = null } }
    let lastEvt = Date.now()
    const setHud = (t: string) => { if (hudRef.current) hudRef.current.textContent = t }
    const setDot = (on: boolean) => dotRef.current?.classList.toggle('off', !on)

    function onEvent(raw: string) {
      let e: { event?: string; tool?: string; detail?: string; session?: string }
      try { e = JSON.parse(raw) } catch { return }
      if (!e || !e.event) return
      lastEvt = Date.now(); setDot(true)
      const res = engine.applyStreamEvent(e, Date.now())
      playFx(res.fx)
      if (res.dirty) dirty = true
      if (res.hud !== null) {
        if (e.event === 'PreToolUse') setHud(`${ZONES[zoneForTool(e.tool)]?.ic || ''} ${res.hud}`)
        else setHud(res.hud)
      }
    }

    function connect() {
      if (stopped || document.hidden || es) return
      clearReconnect()
      try {
        es = new EventSource('/api/stream')
        es.onopen = () => { tries = 0 }
        es.onmessage = (m) => onEvent(m.data)
        es.onerror = () => {
          es?.close(); es = null; setDot(false); tries += 1
          if (tries <= 5 && !stopped) { clearReconnect(); reconnect = setTimeout(connect, Math.min(1000 * tries, 8000)) }
        }
      } catch { /* poll still drives the sprites */ }
    }
    const onVis = () => { if (document.hidden) { es?.close(); es = null } else if (!es) { tries = 0; connect() } }

    // ---- dirty-flag rAF: draws only while something moves (idle = 0 frames) ----
    let raf = 0
    let last = 0
    let lastRoster: LiveAgent[] | null = null
    function frame(t: number) {
      if (stopped) return
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      if (t - last < 33) return // ~30fps cap
      const dt = Math.min(t - last, 100); last = t
      const now = Date.now() // ONE wall-clock read per frame, threaded everywhere (polish-5)
      // roster reconcile only when the polled array identity changes (~1/3s),
      // not per frame — the engine RECONCILES (sprites survive), never rebuilds
      if (agentsRef.current !== lastRoster) {
        lastRoster = agentsRef.current
        const res = engine.syncRoster(agentsRef.current, now)
        playFx(res.fx)
        if (res.dirty) dirty = true
        if (botsRef.current) botsRef.current.textContent = res.hud
        if (focus && !engine.sessions.has(focus)) { focus = null; refreshTowerFocus(); dirty = true }
      }
      const stepped = engine.step(dt, now)
      playFx(stepped.fx)
      let fx = false
      if (FX.parts.length) {
        fx = true
        for (let i = FX.parts.length - 1; i >= 0; i--) {
          const p = FX.parts[i]; p.t -= dt
          if (p.t <= 0) { FX.parts.splice(i, 1); continue }
          // gravity dt-scaled like position (was per-frame, so tab-throttled frames fell harder)
          p.vy += p.g * dt * 0.06; p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06
        }
        // THE 260 cap — one choke-point per frame; every emitter funnels through here so
        // confetti()/emit() can't bypass it. Trim oldest-by-remaining-life: a mass
        // completion culls the dying tails, never the fresh in-flight burst (polish-3).
        if (FX.parts.length > 260) {
          FX.parts.sort((a, b) => b.t - a.t)
          FX.parts.length = 260
        }
      }
      if (FX.shake > 0.1) fx = true
      if (engine.glowActive(now)) fx = true
      if (now - lastEvt > 15000) setDot(false)
      if (stepped.moving || fx || dirty) { draw(now); dirty = false }
      // shake decays in the frame step (sim), not in draw() (render) — polish-5 seam.
      // After the draw so the first shake frame renders at full amplitude; cadence matches
      // the old per-draw decay because a live shake forces fx=true → draw every frame.
      if (FX.shake > 0.1) { FX.shake *= 0.8 } else FX.shake = 0
    }

    const onResize = () => size()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVis)
    cv.addEventListener('pointerdown', onPointerDown)
    connect()
    raf = requestAnimationFrame(frame)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      es?.close(); es = null
      clearReconnect()
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
      cv.removeEventListener('pointerdown', onPointerDown)
    }
    // mount-once BY DESIGN: roster flows via agentsRef; a dep on roster ids is
    // exactly the respawn bug the engine extraction killed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="rm-stage">
      <canvas ref={canvasRef} className="rm-canvas" />
      <span className="rm-hud">
        <span ref={dotRef} className="rm-hud-dot off" />
        <span ref={hudRef} className="rm-hud-act">connecting to live stream…</span>
        <span ref={botsRef} className="rm-hud-bots" />
      </span>
      <div ref={towerRef} className="rm-tower" />
      {agents.length === 0 && <div className="rm-veil">the room is quiet — no sessions working right now</div>}
    </div>
  )
}

export default function Room() {
  const { data } = useApi<LiveAgents>('/api/live-agents', FALLBACK, 3000)
  const agents = data.agents ?? []
  return (
    <div className="room-pixel">
      <FloorPlan agents={agents} />
    </div>
  )
}
