/* ==================================================================== *
 *  FIXTURE MOCK — NOT SHIPPED. Verification aid only.
 *
 *  Stands in for the real claude-room watcher so the
 *  Room page can be exercised without live sessions. Serves the two
 *  endpoints the Room consumes, with a scripted timeline:
 *
 *    GET /api/live-agents  -> LiveAgents roster (changes over time)
 *    GET /api/stream       -> text/event-stream of EventLine JSON
 *
 *  Roster: 4 sessions —
 *    A  big-project     · opus-4.8  · LIVE  · 7 subagents:
 *         5 researchers → ANTENNA bench (cap 3) → 2 bodies + per-zone "+3" chip
 *         1 builder → TERMINAL, 1 tester → WORKBENCH
 *    B  claude-room     · sonnet-5  · LIVE  · 0 subagents
 *    C  brain           · opus-4.8  · DONE  · idle (dimmed to 55%)
 *    D  night-shift     · sonnet-5  · LIVE  · idle, no SSE → sleeps at 45s (Zzz)
 *  Status timeline (cyclic, 20s): at phase 9s the builder flips live->done
 *  (toast ✓ + confetti); at 13s the tester flips live->failed (toast ✗ +
 *  shake + red burst); both revert next cycle so edges recur.
 *  MEMBERSHIP timeline (one-shot): at t=22s a NEW scout subagent joins the
 *  roster — proves the mount-once engine reconciles (new sprite enters via
 *  the gate, existing sprites keep their positions; NO floor respawn).
 *  SSE walks session A around the benches and fires an error spark.
 *
 *  Run:  node mock/server.mjs        (listens on :8181; matches vite proxy)
 * ==================================================================== */
import { createServer } from 'node:http'

const PORT = process.env.PORT ? Number(process.env.PORT) : 8181
const T0 = Date.now()
const elapsed = () => (Date.now() - T0) / 1000

/** Build the roster for the current elapsed time (drives toast/confetti/shake
 *  via the Room's poll diff; drives the no-respawn proof via the 22s join). */
function roster() {
  const t = elapsed()
  const phase = t % 20 // repeating 20s cycle so status EDGES recur for observation
  const agents = []

  // ---- Session A: big-project, 7 subagents ----
  agents.push({ id: 'sess-A', kind: 'session', session: 'mc000001', name: 'claude', job: '', detail: '', model: 'opus-4.8', status: 'live', age_s: Math.round(t), project: 'big-project', tool: 'Edit' })
  // 5 researchers, all homing to the ANTENNA bench (zoneBotCap('web') = 3):
  // engine shows 2 bodies + one honest per-zone "+3" crowd chip on the bench
  for (let i = 0; i < 5; i++) {
    agents.push({ id: `sub-A-res-${i}`, kind: 'subagent', session: 'mc000001', name: `researcher-${i + 1}`, job: 'researcher', detail: 'sweeping the docs', model: i % 2 ? 'sonnet-5' : 'opus-4.8', status: 'live', age_s: Math.round(t) })
  }
  // builder (TERMINAL) — flips done at cycle phase 9s → confetti + ✓ toast
  agents.push({ id: 'sub-A-build', kind: 'subagent', session: 'mc000001', name: 'builder-1', job: 'builder', detail: 'carving the room shell', model: 'opus-4.8', status: phase >= 9 && phase < 14 ? 'done' : 'live', age_s: Math.round(t) })
  // tester (WORKBENCH) — flips failed at cycle phase 13s → shake + ✗ toast
  agents.push({ id: 'sub-A-test', kind: 'subagent', session: 'mc000001', name: 'tester-2', job: 'tester', detail: phase >= 13 && phase < 18 ? 'assertion error in test_room.py' : 'running the suite', model: 'sonnet-5', status: phase >= 13 && phase < 18 ? 'failed' : 'live', age_s: Math.round(t) })

  // ---- ONE-SHOT MEMBERSHIP CHANGE (no-respawn proof): scout joins at t=22s ----
  if (t > 22) {
    agents.push({ id: 'sub-A-scout', kind: 'subagent', session: 'mc000001', name: 'scout-late', job: 'scout', detail: 'late joiner — respawn probe', model: 'sonnet-5', status: 'live', age_s: Math.round(t - 22) })
  }

  // ---- Session B: claude-room, no subagents ----
  agents.push({ id: 'sess-B', kind: 'session', session: 'cr000002', name: 'claude', job: '', detail: '', model: 'sonnet-5', status: 'live', age_s: Math.round(t), project: 'claude-room', tool: 'Bash' })

  // ---- Session C: brain, idle/done ----
  agents.push({ id: 'sess-C', kind: 'session', session: 'br000003', name: 'claude', job: '', detail: '', model: 'opus-4.8', status: 'done', age_s: Math.round(t), project: 'brain', tool: '' })

  // ---- Session D: LIVE but idle at the podium, never touched by SSE ----
  // exercises the alive-anims sleep path: engine spawns it with lastEventAt=now,
  // so after SLEEP_MS (45s) of page-observed quiet it dozes off under drifting Zs
  agents.push({ id: 'sess-D', kind: 'session', session: 'zz000004', name: 'claude', job: '', detail: '', model: 'sonnet-5', status: 'live', age_s: Math.round(t), project: 'night-shift', tool: '' })

  const live = agents.filter((a) => a.status === 'live').length
  return { agents, live, done_recent: 1, ts: Date.now() }
}

// scripted SSE events that walk session A around + fire an error spark
const SSE_SCRIPT = [
  { at: 2, event: 'PreToolUse', session: 'mc000001', tool: 'Read', detail: 'src/sections/Room.tsx' },
  { at: 4, event: 'PreToolUse', session: 'cr000002', tool: 'WebSearch', detail: 'vite sse proxy' },
  { at: 6, event: 'PreToolUse', session: 'mc000001', tool: 'Bash', detail: 'npm run build' },
  { at: 8, event: 'UserPromptSubmit', session: 'mc000001', detail: '' },
  { at: 10, event: 'PreToolUse', session: 'mc000001', tool: 'mcp__windows__screenshot', detail: 'grab the room' },
  { at: 12, event: 'PreToolUse', session: 'mc000001', tool: 'Bash', detail: 'ERROR: traceback in pytest' },
  { at: 15, event: 'PreToolUse', session: 'cr000002', tool: 'Edit', detail: 'vite.config.ts' },
  { at: 18, event: 'PreToolUse', session: 'mc000001', tool: 'Skill', detail: 'deep-research' },
]

const streams = new Set()

const server = createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/api/live-agents')) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(JSON.stringify(roster()))
    return
  }
  if (url.startsWith('/api/stream')) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    res.write(': connected\n\n')
    streams.add(res)
    req.on('close', () => streams.delete(res))
    return
  }
  res.writeHead(404); res.end('not found')
})

function sse(obj) {
  const line = `data: ${JSON.stringify({ ...obj, ts: Date.now() })}\n\n`
  for (const res of streams) res.write(line)
}

server.listen(PORT, () => {
  console.log(`[FIXTURE] claude-room mock watcher on http://localhost:${PORT}`)
  console.log('[FIXTURE] endpoints: /api/live-agents  /api/stream')
  // fire the scripted timeline once, then loop the walk every 20s
  const fireAll = (base) => SSE_SCRIPT.forEach((e) => setTimeout(() => sse(e), (base + e.at) * 1000))
  fireAll(0)
  setInterval(() => fireAll(0), 20000)
  // heartbeat comment so the SSE stays warm
  setInterval(() => { for (const res of streams) res.write(': ping\n\n') }, 8000)
})
