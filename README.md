# claude-room

[![npm](https://img.shields.io/npm/v/claude-room?color=ff9d4d)](https://www.npmjs.com/package/claude-room)
[![node](https://img.shields.io/node/v/claude-room?color=46e6a4)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/claude-room?color=38a8ff)](./LICENSE)

A live **pixel diorama of your Claude Code sessions**. Run one command and a
little room opens in your browser: every running session is an orange pixel
Claude at a bench, subagent swarms cluster by job in their own colours, and
sprites walk between zones as the work happens — typing at the terminal,
hammering at the workbench, dozing off under a drifting **Zzz** when you
leave them idle. Confetti when a job lands, a screen-shake when one fails.

![the room, live](https://raw.githubusercontent.com/NAJEMWEHBE/claude-room/master/docs/hero.png)

## Run it

```bash
npx claude-room
```

That's the whole setup. It starts a local server, prints the URL, and opens
the room in your default browser:

```
claude-room — watching /home/you/.claude/projects
  roster : http://127.0.0.1:8181/api/live-agents
  stream : http://127.0.0.1:8181/api/stream
  room   : http://127.0.0.1:8181/
```

Open sessions walk in through the gate within a couple of seconds. Leave it on
a second monitor and watch your agents work.

![sessions and subagents walking, finishing, failing](https://raw.githubusercontent.com/NAJEMWEHBE/claude-room/master/docs/claude-room.gif)

## What you're looking at

- **Orange sprites** — your main Claude Code sessions, labelled by project and
  model. They walk to the bench of whatever tool they're using right now:
  **TERMINAL** for shell commands, **WORKBENCH** for edits, **LIBRARY** for
  reads, **ANTENNA** for web, **PLAN BOARD**, **SKILLS**, **PORTAL** — and back
  to the **PODIUM** when you prompt them.
- **Coloured sprites** — subagents, coloured by job:
  ![#46e6a4](https://img.shields.io/badge/-builder-46e6a4) ![#a878ff](https://img.shields.io/badge/-scout-a878ff) ![#ff6b7d](https://img.shields.io/badge/-reviewer-ff6b7d) ![#ffc25a](https://img.shields.io/badge/-tester-ffc25a) ![#38a8ff](https://img.shields.io/badge/-researcher-38a8ff) ![#e7c66a](https://img.shields.io/badge/-architect-e7c66a) ![#38e8ff](https://img.shields.io/badge/-helper-38e8ff)
- **Crowd chips (+N)** — when a bench overflows, extra bodies fold into one
  honest per-zone counter.
- **They actually work** — a sprite parked at a bench isn't frozen: it types
  in bursts at the **TERMINAL** (screen flicker included), swings a hammer at
  the **WORKBENCH** (sparks on impact), and does a busy little wiggle at every
  other bench. Leave a session unprompted for 45 seconds and it dozes off at
  the podium under drifting **Zzz** — your next prompt wakes it with a startle
  before it hurries back to work.
- **Toasts, confetti, shake** — a subagent finishing pops a ✓ toast and
  confetti; a failure gets a ✗ toast and shakes the floor. Work sparks fly at
  whichever bench is busy, and every model is readable at a glance under its
  sprite.
- **Status bar** — the last tool call streaming in, live/session counts.

Everything renders on one canvas with a dirty-flag frame loop: an empty or
hidden room draws **zero frames**, and an occupied room idles at **≤6fps**.

### Options

- `--port <n>` (or `PORT=<n>`) — base port; walks forward if it's taken (default `8181`).
- `--no-open` (or `CR_NO_OPEN=1`) — start the server but don't launch a browser.

## Read-only, always

claude-room **never writes to, configures, or instruments Claude Code.** It:

- installs **no hooks** and touches **no settings** — nothing under `~/.claude`
  is modified, ever;
- opens your transcript files **read-only** and derives activity purely by
  tailing the JSONL that Claude Code already writes;
- keeps everything **on `127.0.0.1`** — no telemetry, no network calls, no data
  leaves your machine;
- **redacts** tool details on the wire — absolute paths collapse to basenames
  and token-shaped secrets are masked before anything reaches the browser.

If you close it, it's gone without a trace.

## How it works

A tiny Node watcher (`chokidar` is the only runtime dependency) tails the
transcripts under `~/.claude/projects`, turns appended `tool_use` / `tool_result`
lines into a live event stream, and serves both a roster snapshot
(`/api/live-agents`) and an SSE feed (`/api/stream`). The room is a static
React/Canvas page served from the same origin — no build step, no config.

## Platform notes

- **Windows / macOS / Linux** supported. Transcripts are read from
  `~/.claude/projects` (Windows: `C:\Users\<you>\.claude\projects`).
- Honors `CLAUDE_CONFIG_DIR` if you've relocated Claude Code's state directory.
- Requires **Node.js ≥ 20**.
- On a headless box the browser simply won't open — the printed URL still works
  over an SSH tunnel.

## License

MIT.
