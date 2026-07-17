/* Contract tests for the redaction safety net — the last gate before a tool
 * detail hits the SSE wire and the roster. If these fail, secrets leak. */
import { describe, it, expect } from 'vitest';
import { redact } from './redact.js';

describe('redact — token-shaped secrets', () => {
  it.each([
    ['github pat', 'push with ghp_abcdefghijklmnop1234 done'],
    ['slack token', 'auth xoxb-abcdefghijklmnop1234 ok'],
    ['bearer', 'Authorization: Bearer abc.def-ghi_jkl012345'],
    ['jwt', 'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 sent'],
    ['long hex', 'sha 3b18e512dba79e4c8300dd08aeb37f8e728b8dad here'],
    ['aws key id', 'key AKIAIOSFODNN7EXAMPLE used'],
  ])('masks %s', (_label, input) => {
    const out = redact(input);
    expect(out).toContain('<redacted>');
  });

  it('never passes the raw token through', () => {
    expect(redact('ghp_abcdefghijklmnop1234')).not.toContain('ghp_abcdefghijklmnop1234');
  });
});

describe('redact — path collapsing', () => {
  it('windows absolute → basename', () => {
    expect(redact('C:\\Users\\nino\\proj\\src\\file.ts')).toBe('file.ts');
  });
  it('posix absolute → basename', () => {
    expect(redact('/home/nino/proj/src/file.ts')).toBe('file.ts');
  });
  it('short relative hint survives', () => {
    expect(redact('src/foo.ts')).toBe('src/foo.ts');
  });
});

describe('redact — shape', () => {
  it('collapses whitespace and caps at 120 chars', () => {
    const out = redact('a   b\t\nc ' + 'x'.repeat(300));
    expect(out.startsWith('a b c ')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(120);
  });
  it('empty in, empty out', () => {
    expect(redact('')).toBe('');
  });
});
