# claude-room

A live **pixel diorama of your Claude Code sessions**. Run one command and a
little room opens in your browser: each running session is an orange pixel
Claude at a workbench, subagent swarms gather in coloured clusters by job, and
sprites walk between zones as work happens — reading, building, testing,
researching — with beams, sparks, confetti on success and a shake on failure.

![screenshot placeholder — add a real-session GIF here](docs/claude-room.gif)

> _Screenshot/GIF placeholder — drop a recording in `docs/` before publishing._

## Run it

```bash
npx claude-room
```

That starts a local server, prints the URL, and opens the room in your default
browser:

```
claude-room — watching /home/you/.claude/projects
  roster : http://127.0.0.1:8181/api/live-agents
  stream : http://127.0.0.1:8181/api/stream
  room   : http://127.0.0.1:8181/
```

Open sessions appear within a couple of seconds. Leave it running on a second
monitor while you work.

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
