# claude-room web/ — build notes

`Room.tsx` render shell + `roomEngine.ts` mount-once engine +
`roomEngine.test.ts`. v0.1 scope: session/subagent/workflow roster
kinds only.

## Wire contract the page assumes — CHECK AGAINST THE WATCHER

1. **Endpoints, same-origin:** `GET /api/live-agents` (polled every 3s) and
   `EventSource /api/stream`. The built `dist/` must be served by the watcher
   on the SAME origin as the API — no proxy ships (the vite proxy in
   `vite.config.ts` is dev-only).

2. **Kind vocabulary:** engine whitelist is `session` | `subagent` | `workflow`
   (see `roomEngine.ts` syncRoster). The watcher emits `session`/`subagent` —
   both render; `workflow` is accepted if it ever appears. ANY other kind is
   silently dropped (by design, v0.1 strip). If the watcher invents new kinds,
   they will not render — extend the whitelist deliberately, not implicitly.

3. **Job labels:** subagent colour + home bench is a PURE lookup on `a.job`
   against the seven keys `reviewer scout builder tester researcher architect
   helper` (JOB_META in `roomEngine.ts`). Anything else (or empty) falls to the
   default cyan/LIBRARY. The watcher's `_job_type` port must emit exactly these
   strings — no re-classification happens client-side.

4. **Session id width — 8 chars:** the SSE handler does
   `(e.session || '').slice(0, 8)` and matches it against roster `session`
   values. The watcher must key BOTH the roster `session` field and the SSE
   `session` field with the same 8-char id (map: parent = dir[:8]), or SSE
   events will not find their session sprite (falls back to zone-glow only).

5. **SSE event shape:** `{ ts?, event, session?, tool?, detail?, ok? }` JSON
   per `data:` line. The Room reacts to `event === 'UserPromptSubmit'` (walk
   home to podium) and `event === 'PreToolUse'` (walk to the tool's bench +
   work sparks). Everything else is ignored. A `detail` matching
   /error|failed|exception|traceback/i triggers the error shake.

6. **Roster row fields:** engine `LiveAgent` requires
   `id kind session name job detail model status age_s` (+ optional
   `project task tool` on session rows). `status` ∈ live|done|failed —
   live→non-live EDGES drive toasts/confetti/shake; unknown statuses render
   as done-style.

## Verification fixture (NOT shipped)

`mock/server.mjs` — stands in for the watcher: 3 sessions (one with 7
subagents incl. 5 researchers to saturate the ANTENNA bench → per-zone "+3"
chip; one idle/dim), cyclic done/failed status flips (toast/confetti/shake),
a one-shot subagent join at t=22s (no-respawn probe), scripted SSE walk.
Run `node mock/server.mjs` (:8181) + `npm run dev`; `CR_API` env overrides
the proxy target to point dev at the real watcher instead.

## Commands

- `npm run build` → `dist/` (tsc -b + vite build)
- `npm test` → 33 vitest engine tests (31 engine-behavior tests +
  2 claude-room kind-whitelist tests)
