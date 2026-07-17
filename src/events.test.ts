/* Contract tests for the derivation layer — the seam every transcript line
 * crosses. External format in (parsed JSONL objects, exactly as the watcher
 * hands them over), EventLine[] out. Pure: no fs, no timers except the
 * documented Date.now() fallback for a missing timestamp. */
import { describe, it, expect } from 'vitest';
import { deriveEvents } from './events.js';

const TS = '2026-07-15T17:47:19.319Z';
const TS_S = Date.parse(TS) / 1000;

function assistantToolUse(name: string, input: unknown, sessionId?: string) {
  return {
    type: 'assistant',
    ...(sessionId ? { sessionId } : {}),
    timestamp: TS,
    message: { content: [{ type: 'tool_use', name, input }] },
  };
}

describe('deriveEvents — assistant tool_use → PreToolUse', () => {
  it('emits PreToolUse with 8-char session, epoch-seconds ts, basename detail', () => {
    const out = deriveEvents(assistantToolUse('Read', { file_path: 'C:\\Users\\x\\proj\\deep\\file.ts' }, 'abcdef1234567890'), 'fallback');
    expect(out).toEqual([
      { event: 'PreToolUse', session: 'abcdef12', tool: 'Read', detail: 'file.ts', ok: true, ts: TS_S },
    ]);
  });

  it('falls back to the path-derived session when the line has no sessionId', () => {
    const out = deriveEvents(assistantToolUse('Glob', { pattern: '**/*.ts' }), 'deadbeef');
    expect(out[0]!.session).toBe('deadbeef');
  });

  it('summarizes Bash by its command, sliced', () => {
    const out = deriveEvents(assistantToolUse('Bash', { command: 'git status', description: 'ignored' }), 'x');
    expect(out[0]!.detail).toBe('git status');
  });

  it('redacts token-shaped secrets before they reach the wire', () => {
    const out = deriveEvents(assistantToolUse('Bash', { command: 'curl -H "Authorization: Bearer abc123def456ghi789"' }), 'x');
    expect(out[0]!.detail).toContain('<redacted>');
    expect(out[0]!.detail).not.toContain('abc123def456ghi789');
  });

  it('one line with several tool_use blocks emits one event per block', () => {
    const obj = {
      type: 'assistant',
      timestamp: TS,
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/a/b.ts' } },
          { type: 'tool_use', name: 'Grep', input: { pattern: 'foo', glob: '*.ts' } },
          { type: 'text', text: 'not a tool' },
        ],
      },
    };
    const out = deriveEvents(obj, 'x');
    expect(out.map((e) => e.tool)).toEqual(['Read', 'Grep']);
    expect(out[1]!.detail).toBe('foo *.ts');
  });
});

describe('deriveEvents — user turns', () => {
  it('tool_result with is_error → PostToolUse ok:false, "error: " detail', () => {
    const obj = {
      type: 'user',
      timestamp: TS,
      message: { content: [{ type: 'tool_result', is_error: true, content: 'ENOENT no such file' }] },
    };
    const out = deriveEvents(obj, 'x');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ event: 'PostToolUse', ok: false });
    expect(out[0]!.detail.startsWith('error: ')).toBe(true);
  });

  it('a tool-result turn is NEVER a user prompt (even with no errors)', () => {
    const obj = {
      type: 'user',
      timestamp: TS,
      message: { content: [{ type: 'tool_result', is_error: false, content: 'fine' }] },
    };
    expect(deriveEvents(obj, 'x')).toEqual([]);
  });

  it('plain text turn (array content) → UserPromptSubmit with the joined text', () => {
    const obj = {
      type: 'user',
      timestamp: TS,
      message: { content: [{ type: 'text', text: 'fix the bug' }, { type: 'text', text: 'please' }] },
    };
    const out = deriveEvents(obj, 'x');
    expect(out[0]).toMatchObject({ event: 'UserPromptSubmit', detail: 'fix the bug please' });
  });

  it('string content → UserPromptSubmit; blank string → nothing', () => {
    const mk = (content: string) => ({ type: 'user', timestamp: TS, message: { content } });
    expect(deriveEvents(mk('hello'), 'x')[0]).toMatchObject({ event: 'UserPromptSubmit', detail: 'hello' });
    expect(deriveEvents(mk('   '), 'x')).toEqual([]);
  });
});

describe('deriveEvents — hostile/junk input never throws, never emits', () => {
  it.each([null, 42, 'str', {}, { type: 'assistant' }, { type: 'assistant', message: {} }, { type: 'summary', message: { content: 'x' } }])(
    'returns [] for %j',
    (junk) => {
      expect(deriveEvents(junk, 'x')).toEqual([]);
    }
  );
});
