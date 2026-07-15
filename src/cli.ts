#!/usr/bin/env node
/**
 * claude-room entry point. Starts the transcript watcher + HTTP/SSE server,
 * prints the localhost URL, and opens it in the default browser. Read-only:
 * touches nothing under ~/.claude.
 *   PORT env or --port <n> sets the base port (default 8181; walks up if taken).
 *   --no-open (or CR_NO_OPEN=1) skips launching the browser.
 */
import { spawn } from 'node:child_process';
import { TranscriptWatcher } from './watcher.js';
import { createServer, listen } from './server.js';
import { PROJECTS_DIR } from './paths.js';

function argPort(): number {
  const i = process.argv.indexOf('--port');
  if (i >= 0 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const env = Number(process.env.PORT);
  if (Number.isFinite(env) && env > 0) return env;
  return 8181;
}

/** Open a URL in the OS default browser. Best-effort, detached, never blocks or
 *  throws — a headless box simply keeps the printed URL. No external deps. */
function openBrowser(url: string): void {
  if (process.argv.includes('--no-open') || process.env.CR_NO_OPEN) return;
  const plat = process.platform;
  let cmd: string;
  let args: string[];
  if (plat === 'win32') {
    // `start` is a cmd builtin; empty "" is the window-title arg it needs.
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (plat === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* no browser launcher available — the URL is already printed */
  }
}

async function main(): Promise<void> {
  const watcher = new TranscriptWatcher();
  watcher.start();

  const server = createServer(watcher);
  const port = await listen(server, argPort());

  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(`claude-room — watching ${PROJECTS_DIR}\n`);
  process.stdout.write(`  roster : ${url}/api/live-agents\n`);
  process.stdout.write(`  stream : ${url}/api/stream\n`);
  process.stdout.write(`  room   : ${url}/\n`);

  openBrowser(url);

  const shutdown = async () => {
    process.stdout.write('\nclaude-room shutting down…\n');
    await watcher.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  process.stderr.write(`claude-room failed to start: ${e}\n`);
  process.exit(1);
});
