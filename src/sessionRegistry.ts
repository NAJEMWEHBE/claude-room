/**
 * Live-session registry join — the ground truth for "is this session actually
 * open". The harness writes ~/.claude/sessions/<pid>.json on session start and
 * DELETES it on exit; a crash can orphan a file, so every pid is liveness-checked.
 * Ported from mission-control's room-roster-truth fix (2026-07-18): transcript
 * mtime alone let headless one-shot runs and just-exited/archived sessions read
 * "live" for minutes, and a burst of them could displace real open sessions
 * from the capped roster.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_DIR } from './paths.js';

export const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');

export interface OpenSession {
  pid: number;
  kind: string;
  name: string;
}

/** Signal-0 probe. EPERM = exists but not ours — still alive. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 8-char session id -> registry entry, for every entry whose pid is ALIVE.
 * Returns null when the registry dir does not exist at all (older harness):
 * the caller then falls back to the mtime heuristic. An empty map is
 * meaningful — registry present, nothing open.
 */
export async function openSessions(
  dir = SESSIONS_DIR,
  alive: (pid: number) => boolean = pidAlive
): Promise<Map<string, OpenSession> | null> {
  let ents;
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const reg = new Map<string, OpenSession>();
  for (const ent of ents) {
    if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(await fsp.readFile(path.join(dir, ent.name), 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const sid = typeof obj['sessionId'] === 'string' ? (obj['sessionId'] as string).slice(0, 8) : '';
    const pid = typeof obj['pid'] === 'number' ? (obj['pid'] as number) : NaN;
    if (!sid || !Number.isFinite(pid)) continue;
    if (alive(pid)) reg.set(sid, { pid, kind: String(obj['kind'] ?? ''), name: String(obj['name'] ?? '') });
  }
  return reg;
}
