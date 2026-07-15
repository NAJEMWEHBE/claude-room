/**
 * Transcript intelligence — a pure watcher: model/cwd are read straight from
 * the transcript JSONL, never instrumented. Caches by mtime so the poll costs
 * one stat on unchanged files. Every function degrades to a safe empty value,
 * never throws.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR } from './paths.js';
import { jobType, prettyModel, projLabel } from './model.js';
import type { LiveAgent } from './types.js';
import type { SessionBand } from './bands.js';

// liveness windows (seconds)
const LIVE_S = 90;
const LINGER_S = 300;
const SESSION_LIVE_S = 240;
const SESSION_LINGER_S = 600;

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

// ---- tail / head byte reads (fd-based; rotation-safe like the Python fstat reads) ----
async function tailText(p: string, nbytes = 65536): Promise<string> {
  let fd: fsp.FileHandle | null = null;
  try {
    fd = await fsp.open(p, 'r');
    const st = await fd.stat();
    const start = Math.max(0, st.size - nbytes);
    const len = st.size - start;
    if (len <= 0) return '';
    const buf = Buffer.allocUnsafe(len);
    await fd.read(buf, 0, len, start);
    return buf.toString('utf-8');
  } catch {
    return '';
  } finally {
    await fd?.close().catch(() => {});
  }
}

async function headText(p: string, nbytes = 65536): Promise<string> {
  let fd: fsp.FileHandle | null = null;
  try {
    fd = await fsp.open(p, 'r');
    const buf = Buffer.allocUnsafe(nbytes);
    const { bytesRead } = await fd.read(buf, 0, nbytes, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } catch {
    return '';
  } finally {
    await fd?.close().catch(() => {});
  }
}

// ---- model/cwd meta, cached by (path,mtime) ----
interface MetaEntry {
  mtime: number;
  model: string;
  cwd: string;
}
const MODEL_CACHE = new Map<string, MetaEntry>();

/** (prettyModel, cwd) from a transcript's tail. Last non-synthetic message.model
 *  wins (freshest turn); cwd is top-level. Cached by mtime. Never throws. */
export async function transcriptMeta(p: string, mtimeMs: number): Promise<{ model: string; cwd: string }> {
  const mt = Math.floor(mtimeMs);
  const cached = MODEL_CACHE.get(p);
  if (cached && cached.mtime === mt) return { model: cached.model, cwd: cached.cwd };

  let modelRaw = '';
  let cwd = '';
  const tail = await tailText(p);
  for (const ln of tail.split('\n')) {
    const line = ln.trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // first tail line is usually a mid-file fragment
    }
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;
    const msg = o['message'];
    if (msg && typeof msg === 'object') {
      const v = (msg as Record<string, unknown>)['model'];
      if (typeof v === 'string' && v && v !== '<synthetic>') modelRaw = v; // keep LAST
    }
    const c = o['cwd'];
    if (typeof c === 'string' && c) cwd = c; // top-level; last real cwd wins
  }
  const model = prettyModel(modelRaw);
  MODEL_CACHE.set(p, { mtime: mt, model, cwd });
  return { model, cwd };
}

// ---- first prompt (workflow subagents' only on-disk identity) ----
const PROMPT_CACHE = new Map<string, string>(); // line 1 never changes once written
async function firstPrompt(p: string): Promise<string> {
  const cached = PROMPT_CACHE.get(p);
  if (cached) return cached;
  let text = '';
  const head = await headText(p);
  const firstLine = head.split('\n', 1)[0] ?? '';
  try {
    const obj = JSON.parse(firstLine) as Record<string, unknown>;
    const msg = obj['message'];
    const content = msg && typeof msg === 'object' ? (msg as Record<string, unknown>)['content'] : undefined;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b && typeof b === 'object' && (b as Record<string, unknown>)['type'] === 'text')
        .map((b) => String((b as Record<string, unknown>)['text'] ?? ''))
        .join(' ');
    }
  } catch {
    /* torn read of a just-created file — don't cache, retry next poll */
  }
  text = text.split(/\s+/).join(' ').replace(/^#+/, '').trim().slice(0, 160);
  if (text) PROMPT_CACHE.set(p, text);
  return text;
}

function readJson(p: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---- rotation-safe error probes over the tail ----
async function tailHasError(p: string): Promise<boolean> {
  const t = await tailText(p, 4096);
  return t.includes('"is_error": true') || t.includes('"is_error":true');
}
async function tailHasApiError(p: string): Promise<boolean> {
  const t = await tailText(p, 4096);
  return t.includes('"isApiErrorMessage":true') || t.includes('"isApiErrorMessage": true') || t.includes('"apiErrorStatus"');
}

// ---- directory walk helpers (no glob dep) ----
async function safeReaddir(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Every subagent transcript path under a project (native + workflow), with its
 *  workflow tag. Mirrors proj.glob("*​/subagents/agent-*.jsonl") + workflows glob. */
async function subagentFiles(projDir: string): Promise<Array<{ file: string; wf: string; sessionDir: string }>> {
  const out: Array<{ file: string; wf: string; sessionDir: string }> = [];
  for (const sess of await safeReaddir(projDir)) {
    if (!sess.isDirectory()) continue;
    const subDir = path.join(projDir, sess.name, 'subagents');
    for (const ent of await safeReaddir(subDir)) {
      if (ent.isFile() && /^agent-.*\.jsonl$/.test(ent.name)) {
        out.push({ file: path.join(subDir, ent.name), wf: '', sessionDir: sess.name });
      } else if (ent.isDirectory() && ent.name === 'workflows') {
        const wfRoot = path.join(subDir, 'workflows');
        for (const wf of await safeReaddir(wfRoot)) {
          if (!wf.isDirectory()) continue;
          for (const f of await safeReaddir(path.join(wfRoot, wf.name))) {
            if (f.isFile() && /^agent-.*\.jsonl$/.test(f.name)) {
              out.push({ file: path.join(wfRoot, wf.name, f.name), wf: wf.name, sessionDir: sess.name });
            }
          }
        }
      }
    }
  }
  return out;
}

// ---- public scanners ----

/** Native subagents + workflow subagents across every project. Port of _scan_transcripts. */
export async function scanSubagents(now: number): Promise<LiveAgent[]> {
  const out: LiveAgent[] = [];
  const projects = await safeReaddir(PROJECTS_DIR);
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(PROJECTS_DIR, proj.name);
    for (const { file, wf, sessionDir } of await subagentFiles(projDir)) {
      let st: fs.Stats;
      try {
        st = await fsp.stat(file);
      } catch {
        continue;
      }
      const age = now - st.mtimeMs / 1000;
      if (age > LIVE_S + LINGER_S) continue;

      const stem = path.basename(file).replace(/\.jsonl$/, '');
      const metaPath = path.join(path.dirname(file), stem + '.meta.json');
      const meta = readJson(metaPath);
      let name = (meta['agentType'] as string) || 'agent';
      let desc = (meta['description'] as string) || '';
      if (!desc) {
        const prompt = await firstPrompt(file);
        if (prompt) {
          desc = prompt;
          if (name === 'workflow-subagent' || name === 'agent') {
            name = prompt.length > 24 ? prompt.slice(0, 23) + '…' : prompt;
          }
        }
      }
      desc = desc || stem;
      const parent = sessionDir.slice(0, 8);
      const { model } = await transcriptMeta(file, st.mtimeMs);

      let status: string;
      if (await tailHasApiError(file)) status = 'failed';
      else if (age <= LIVE_S) status = 'live';
      else if (await tailHasError(file)) status = 'failed';
      else status = 'done';

      out.push({
        id: (wf ? 'wf:' + wf + ':' : 'ag:') + stem,
        kind: wf ? 'workflow' : 'subagent',
        name,
        job: jobType(desc + ' ' + ((meta['agentType'] as string) || '')),
        detail: desc.slice(0, 120),
        session: parent,
        model,
        status,
        age_s: Math.floor(age),
      });
    }
  }
  return out;
}

/** Main sessions = root-level projects/<proj>/<uuid>.jsonl touched recently.
 *  tool/action come from the folded live bands. */
export async function scanSessions(now: number, bands: Map<string, SessionBand>): Promise<LiveAgent[]> {
  const out: LiveAgent[] = [];
  const projects = await safeReaddir(PROJECTS_DIR);
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(PROJECTS_DIR, proj.name);
    for (const ent of await safeReaddir(projDir)) {
      if (!ent.isFile() || !ent.name.endsWith('.jsonl')) continue; // root-level only
      const file = path.join(projDir, ent.name);
      let st: fs.Stats;
      try {
        st = await fsp.stat(file);
      } catch {
        continue;
      }
      const age = now - st.mtimeMs / 1000;
      if (age > SESSION_LIVE_S + SESSION_LINGER_S) continue;

      const sid = ent.name.replace(/\.jsonl$/, '').slice(0, 8);
      const { model, cwd } = await transcriptMeta(file, st.mtimeMs);
      const band = bands.get(sid);
      const last = band?.last;
      const tool = last?.tool ?? '';
      const project = projLabel(cwd) || projLabel(proj.name) || sid;
      let action = '';
      if (last) {
        const d = (last.detail || '').trim();
        action = tool ? (tool + ' ' + d).trim().slice(0, 48) : '';
      }
      out.push({
        id: 'sess:' + sid,
        kind: 'session',
        session: sid,
        name: project,
        project,
        task: action,
        job: '',
        detail: action.slice(0, 120),
        model,
        tool,
        status: age <= SESSION_LIVE_S ? 'live' : 'done',
        age_s: Math.floor(age),
      });
    }
  }
  out.sort((a, b) => a.age_s - b.age_s);
  return out.slice(0, 8);
}

export { WRITE_TOOLS, LIVE_S, SESSION_LIVE_S };
