/* Contract tests for the live-session registry join (room-roster-truth port).
 * Mirrors mission-control's test_open_sessions_registry. */
import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSessions, pidAlive } from './sessionRegistry.js';

const DEAD_PID = 999999991; // implausible -> ESRCH

async function tmpdir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'claude-room-reg-'));
}

describe('pidAlive', () => {
  it('own pid alive, implausible pid dead', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(DEAD_PID)).toBe(false);
  });
});

describe('openSessions', () => {
  it('keeps alive-pid entries, drops dead pids and malformed files', async () => {
    const dir = await tmpdir();
    await fsp.writeFile(
      path.join(dir, '1.json'),
      JSON.stringify({ pid: process.pid, sessionId: 'aaaabbbb-1111-2222-3333-444455556666', kind: 'interactive' })
    );
    await fsp.writeFile(
      path.join(dir, '2.json'),
      JSON.stringify({ pid: DEAD_PID, sessionId: 'ccccdddd-1111-2222-3333-444455556666' })
    );
    await fsp.writeFile(path.join(dir, '3.json'), 'not json');
    await fsp.writeFile(path.join(dir, '4.json'), JSON.stringify({ sessionId: 'eeeeffff-no-pid' }));
    const reg = (await openSessions(dir))!;
    expect([...reg.keys()]).toEqual(['aaaabbbb']);
    expect(reg.get('aaaabbbb')!.kind).toBe('interactive');
  });

  it('missing dir -> null (legacy-fallback signal); empty dir -> empty map', async () => {
    const dir = await tmpdir();
    expect(await openSessions(path.join(dir, 'nope'))).toBeNull();
    const empty = await openSessions(dir);
    expect(empty).not.toBeNull();
    expect(empty!.size).toBe(0);
  });

  it('injected alive-probe is honoured (deterministic liveness in tests)', async () => {
    const dir = await tmpdir();
    await fsp.writeFile(
      path.join(dir, '9.json'),
      JSON.stringify({ pid: 12345, sessionId: '99998888-1111-2222-3333-444455556666' })
    );
    expect((await openSessions(dir, () => true))!.has('99998888')).toBe(true);
    expect((await openSessions(dir, () => false))!.size).toBe(0);
  });
});
