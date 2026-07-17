/* Contract tests for the live-band fold — the roster's only source for
 * "which bench is this session at right now". */
import { describe, it, expect } from 'vitest';
import { foldBands } from './bands.js';
import type { EventLine } from './types.js';

const NOW = 1_000_000;
const pre = (session: string, tool: string, ts: number, detail = ''): EventLine => ({ event: 'PreToolUse', session, tool, detail, ok: true, ts });
const prompt = (session: string, ts: number): EventLine => ({ event: 'UserPromptSubmit', session, tool: '', detail: '', ok: true, ts });

describe('foldBands', () => {
  it('newest tool-bearing event per session wins', () => {
    const bands = foldBands([pre('aaaa1111', 'Read', NOW - 30), pre('aaaa1111', 'Bash', NOW - 10)], NOW);
    expect(bands.get('aaaa1111')!.last).toMatchObject({ tool: 'Bash', ago_s: 10 });
  });

  it('UserPromptSubmit clears the bench (last → null)', () => {
    const bands = foldBands([pre('aaaa1111', 'Read', NOW - 30), prompt('aaaa1111', NOW - 5)], NOW);
    expect(bands.get('aaaa1111')!.last).toBeNull();
  });

  it('sessions fold independently; ids are cut to 8 chars; blank session skipped', () => {
    const bands = foldBands(
      [pre('aaaa1111ffff', 'Read', NOW - 3), pre('bbbb2222', 'Grep', NOW - 4), pre('', 'Bash', NOW - 1)],
      NOW
    );
    expect([...bands.keys()].sort()).toEqual(['aaaa1111', 'bbbb2222']);
  });

  it('ok:false carries through; missing ts never yields negative age', () => {
    const bands = foldBands([{ event: 'PreToolUse', session: 'cccc3333', tool: 'Edit', detail: 'x', ok: false, ts: NOW + 60 }], NOW);
    const last = bands.get('cccc3333')!.last!;
    expect(last.ok).toBe(false);
    expect(last.ago_s).toBe(0); // clock skew clamped, never negative
  });
});
