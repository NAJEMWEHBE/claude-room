/**
 * Derivation layer — hook-free. Turns an
 * appended transcript JSONL line into EventLine events:
 *   assistant tool_use block   -> PreToolUse  {session, tool, detail, ts}
 *   user tool_result is_error  -> PostToolUse {session, tool:'', detail, ok:false}
 *   user text turn             -> UserPromptSubmit {session, detail}
 * Detail is a short, path/secret-redacted summary of the call — never the raw arg.
 */
import path from 'node:path';
import { redact } from './redact.js';
import type { EventLine } from './types.js';

/** ISO ("2026-07-15T17:47:19.319Z") or epoch -> epoch SECONDS. */
function toEpochSeconds(ts: unknown): number {
  if (typeof ts === 'number') return ts > 1e12 ? ts / 1000 : ts;
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms)) return ms / 1000;
  }
  return Date.now() / 1000;
}

function base(p: unknown): string {
  return typeof p === 'string' ? path.basename(p.replace(/\\/g, '/')) : '';
}
function firstStr(input: Record<string, unknown>): string {
  for (const v of Object.values(input)) if (typeof v === 'string' && v) return v;
  return '';
}

/** Short human hint of a tool call from its input (pre-redaction). */
function summarizeInput(tool: string, input: unknown): string {
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const t = tool.toLowerCase();
  if (/^(read|edit|write|notebookedit|multiedit)$/.test(t)) return base(i['file_path'] ?? i['notebook_path']);
  if (t === 'bash' || t === 'powershell' || t === 'killshell') {
    const cmd = String(i['command'] ?? '');
    return (cmd || String(i['description'] ?? '')).slice(0, 80);
  }
  if (t === 'grep') return String(i['pattern'] ?? '') + (i['glob'] ? ' ' + i['glob'] : '');
  if (t === 'glob') return String(i['pattern'] ?? '');
  if (t === 'task' || t === 'agent') return String(i['description'] ?? i['subagent_type'] ?? '');
  if (t === 'skill') return String(i['skill'] ?? i['command'] ?? '');
  if (t === 'webfetch' || t === 'websearch') return String(i['url'] ?? i['query'] ?? '');
  if (t === 'todowrite') return 'todos';
  if (t.startsWith('mcp__')) return String(i['description'] ?? firstStr(i)).slice(0, 80);
  return firstStr(i).slice(0, 80);
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' ? String((b as Record<string, unknown>)['text'] ?? '') : ''))
      .join(' ');
  }
  return '';
}

/**
 * Derive EventLine[] from one parsed transcript object. `sessionFallback` is the
 * 8-char id inferred from the file path (used when the line lacks sessionId).
 */
export function deriveEvents(obj: unknown, sessionFallback: string): EventLine[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as Record<string, unknown>;
  const type = o['type'];
  const session = (typeof o['sessionId'] === 'string' && o['sessionId'] ? o['sessionId'] : sessionFallback).slice(0, 8);
  const ts = toEpochSeconds(o['timestamp']);
  const msg = o['message'];
  if (!msg || typeof msg !== 'object') return [];
  const content = (msg as Record<string, unknown>)['content'];
  const out: EventLine[] = [];

  if (type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const blk = b as Record<string, unknown>;
      if (blk['type'] === 'tool_use') {
        const tool = String(blk['name'] ?? '');
        if (!tool) continue;
        out.push({ event: 'PreToolUse', session, tool, detail: redact(summarizeInput(tool, blk['input'])), ok: true, ts });
      }
    }
    return out;
  }

  if (type === 'user') {
    if (Array.isArray(content)) {
      const results = content.filter(
        (b) => b && typeof b === 'object' && (b as Record<string, unknown>)['type'] === 'tool_result'
      ) as Array<Record<string, unknown>>;
      if (results.length) {
        for (const r of results) {
          if (r['is_error'] === true) {
            const detail = redact(resultText(r['content'])) || 'error';
            out.push({ event: 'PostToolUse', session, tool: '', detail: 'error: ' + detail.slice(0, 100), ok: false, ts });
          }
        }
        return out; // a tool-result turn is never a user prompt
      }
      // plain user text turn
      const text = content
        .filter((b) => b && typeof b === 'object' && (b as Record<string, unknown>)['type'] === 'text')
        .map((b) => String((b as Record<string, unknown>)['text'] ?? ''))
        .join(' ');
      if (text.trim()) out.push({ event: 'UserPromptSubmit', session, tool: '', detail: redact(text), ok: true, ts });
      return out;
    }
    if (typeof content === 'string' && content.trim()) {
      out.push({ event: 'UserPromptSubmit', session, tool: '', detail: redact(content), ok: true, ts });
    }
  }
  return out;
}
