/**
 * HTTP + SSE server. Two live surfaces (Room.tsx contract) plus optional static
 * serving of the built web app. node:http only — no express. Read-only.
 *   GET /api/live-agents -> LiveAgents snapshot
 *   GET /api/stream      -> SSE: replay last ~50 events, then live push
 *   /*                   -> web/dist static (SPA fallback) if present
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TranscriptWatcher } from './watcher.js';
import { buildRoster } from './roster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/server.js -> repo root is one up from dist/
const WEB_DIST = path.resolve(__dirname, '..', 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(s);
}

async function serveStatic(res: http.ServerResponse, urlPath: string): Promise<void> {
  if (!fs.existsSync(WEB_DIST)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('web/dist not built yet — run the frontend build. API is live at /api/live-agents and /api/stream.');
    return;
  }
  // resolve within WEB_DIST (path-traversal safe), SPA-fallback to index.html
  let rel = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  if (rel === '/' || rel === '') rel = '/index.html';
  let file = path.join(WEB_DIST, rel);
  if (!file.startsWith(WEB_DIST)) file = path.join(WEB_DIST, 'index.html');
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(WEB_DIST, 'index.html'); // SPA fallback
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

export function createServer(watcher: TranscriptWatcher): http.Server {
  return http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
      res.end();
      return;
    }

    if (url.startsWith('/api/live-agents')) {
      try {
        sendJson(res, 200, await buildRoster(watcher.recent()));
      } catch (e) {
        sendJson(res, 500, { agents: [], live: 0, done_recent: 0, ts: Date.now() / 1000, error: String(e) });
      }
      return;
    }

    if (url.startsWith('/api/stream')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      for (const e of watcher.replay(50)) res.write(`data: ${JSON.stringify(e)}\n\n`);

      const onEvent = (e: unknown) => {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      };
      watcher.on('event', onEvent);
      const heartbeat = setInterval(() => res.write(': hb\n\n'), 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        watcher.off('event', onEvent);
      };
      req.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }

    if (url.startsWith('/api/')) {
      sendJson(res, 404, { error: 'unknown endpoint' });
      return;
    }

    await serveStatic(res, url);
  });
}

/** Listen on `port`, walking forward on EADDRINUSE (up to 20 tries). */
export function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (p: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < 20) {
          attempt++;
          tryPort(p + 1);
        } else {
          reject(err);
        }
      });
      server.listen(p, '127.0.0.1', () => resolve(p));
    };
    tryPort(port);
  });
}
