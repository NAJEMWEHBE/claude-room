/**
 * Live transcript watcher. chokidar watches ~/.claude/projects; each appended
 * JSONL line is tail-read incrementally (per-file byte offset + partial-line
 * buffer, truncation/rotation safe) and run through deriveEvents. Emitted events
 * land on an EventEmitter (SSE push) and a bounded ring buffer (roster bands +
 * SSE replay). Read-only: opens transcripts 'r', never writes the watched tree.
 */
import chokidar, { type FSWatcher } from 'chokidar';
import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR } from './paths.js';
import { deriveEvents } from './events.js';
import type { EventLine } from './types.js';

const RING_CAP = 2000;

interface Cursor {
  offset: number;
  partial: string;
}

export class TranscriptWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private cursors = new Map<string, Cursor>();
  private ring: EventLine[] = [];
  private ready = false;

  /** 8-char session id inferred from a transcript path (fallback when a line
   *  lacks its own sessionId). Root file -> basename; subagent -> its <uuid> dir. */
  private sessionFromPath(file: string): string {
    const rel = path.relative(PROJECTS_DIR, file).split(path.sep);
    // rel = [<proj>, <uuid>.jsonl]  OR  [<proj>, <uuid>, subagents, ...]
    const seg = rel[1] ?? '';
    return seg.replace(/\.jsonl$/, '').slice(0, 8);
  }

  private push(e: EventLine): void {
    this.ring.push(e);
    if (this.ring.length > RING_CAP) this.ring.splice(0, this.ring.length - RING_CAP);
    this.emit('event', e);
  }

  private async readNew(file: string): Promise<void> {
    if (!file.endsWith('.jsonl')) return;
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return;
    }
    let cur = this.cursors.get(file);
    if (!cur) cur = { offset: 0, partial: '' };
    if (st.size < cur.offset) cur = { offset: 0, partial: '' }; // truncated / rotated
    if (st.size === cur.offset) return;

    let fd: fsp.FileHandle | null = null;
    let chunk = '';
    try {
      fd = await fsp.open(file, 'r');
      const len = st.size - cur.offset;
      const buf = Buffer.allocUnsafe(len);
      await fd.read(buf, 0, len, cur.offset);
      chunk = buf.toString('utf-8');
    } catch {
      return;
    } finally {
      await fd?.close().catch(() => {});
    }

    const text = cur.partial + chunk;
    const lines = text.split('\n');
    const partial = lines.pop() ?? ''; // trailing (possibly incomplete) line
    this.cursors.set(file, { offset: st.size, partial });

    const fallback = this.sessionFromPath(file);
    for (const ln of lines) {
      const line = ln.trim();
      if (!line) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      for (const ev of deriveEvents(obj, fallback)) this.push(ev);
    }
  }

  start(): void {
    this.watcher = chokidar.watch(PROJECTS_DIR, {
      persistent: true,
      ignoreInitial: false, // see existing files during scan so we can seed offsets
      depth: 6,
      awaitWriteFinish: false,
      ignored: (p: string) => {
        // watch dirs + .jsonl only; skip the noisy sidecars / other files
        if (p.endsWith('.jsonl')) return false;
        return /\.(meta\.json|json|txt|md|lock)$/.test(p);
      },
    });

    this.watcher
      .on('add', (file, stats) => {
        if (!file.endsWith('.jsonl')) return;
        if (!this.ready) {
          // initial scan: seed to current size so we don't replay history
          this.cursors.set(file, { offset: stats?.size ?? 0, partial: '' });
        } else {
          // genuinely new transcript: read from the top (captures its first prompt)
          this.cursors.set(file, { offset: 0, partial: '' });
          void this.readNew(file);
        }
      })
      .on('change', (file) => void this.readNew(file))
      .on('unlink', (file) => this.cursors.delete(file))
      .on('ready', () => {
        this.ready = true;
      })
      .on('error', () => {
        /* swallow — a transient FS error must not kill the watcher */
      });
  }

  /** Bounded rolling event buffer (oldest -> newest). */
  recent(): EventLine[] {
    return this.ring;
  }

  /** Last n events for SSE replay. */
  replay(n = 50): EventLine[] {
    return this.ring.slice(-n);
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
