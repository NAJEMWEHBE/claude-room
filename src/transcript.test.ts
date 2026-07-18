/* Contract tests for scanSessions' registry-join liveness (room-roster-truth
 * port, 2026-07-18). Mirrors mission-control's test_sessions_registry_join /
 * test_sessions_live_first_cap / test_sessions_legacy_fallback.
 *
 * PROJECTS_DIR binds at module load from CLAUDE_CONFIG_DIR, so each test
 * stubs the env and re-imports transcript.js against a temp dir. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { OpenSession } from './sessionRegistry.js';

const NOW = Date.now() / 1000;

type TranscriptModule = typeof import('./transcript.js');

async function loadAgainst(specs: Array<[stem: string, ageS: number]>): Promise<TranscriptModule> {
  const claudeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-room-tr-'));
  const proj = path.join(claudeDir, 'projects', 'F--fake');
  await fsp.mkdir(proj, { recursive: true });
  for (const [stem, age] of specs) {
    const f = path.join(proj, stem + '.jsonl');
    await fsp.writeFile(f, '');
    await fsp.utimes(f, NOW - age, NOW - age);
  }
  vi.resetModules();
  vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir);
  return import('./transcript.js');
}

const reg = (...sids: string[]): Map<string, OpenSession> =>
  new Map(sids.map((s) => [s, { pid: 1, kind: 'interactive', name: 'x' }]));

afterEach(() => vi.unstubAllEnvs());

describe('scanSessions registry join', () => {
  it('open+idle -> live (parked stays); fresh unregistered -> done never live; past linger -> gone', async () => {
    const tr = await loadAgainst([
      ['11111111-aaaa-bbbb-cccc-ddddeeee0001', 5000], // open, transcript long idle
      ['22222222-aaaa-bbbb-cccc-ddddeeee0002', 10], // ghost: fresh file, no process
      ['33333333-aaaa-bbbb-cccc-ddddeeee0003', 700], // dead + past SESSION_LINGER_S=600
    ]);
    const out = await tr.scanSessions(NOW, new Map(), reg('11111111'));
    const by = new Map(out.map((a) => [a.session, a.status]));
    expect(by.get('11111111')).toBe('live');
    expect(by.get('22222222')).toBe('done');
    expect(by.has('33333333')).toBe(false);
  });

  it('live-first cap: 8 fresh ghosts never displace the older real open session', async () => {
    const specs: Array<[string, number]> = [];
    for (let i = 1; i <= 8; i++) specs.push([`${String(i).repeat(8)}-aaaa-bbbb-cccc-ddddeeee000${i}`, 20 + i]);
    specs.push(['99999999-aaaa-bbbb-cccc-ddddeeee0009', 400]); // the real session, older file
    const tr = await loadAgainst(specs);
    const out = await tr.scanSessions(NOW, new Map(), reg('99999999'));
    expect(out).toHaveLength(8);
    expect(out[0]).toMatchObject({ session: '99999999', status: 'live' });
  });

  it('legacy fallback (reg null = no registry dir): old mtime heuristic', async () => {
    const tr = await loadAgainst([
      ['44444444-aaaa-bbbb-cccc-ddddeeee0004', 10],
      ['55555555-aaaa-bbbb-cccc-ddddeeee0005', 300], // > SESSION_LIVE_S=240, within linger
    ]);
    const out = await tr.scanSessions(NOW, new Map(), null);
    const by = new Map(out.map((a) => [a.session, a.status]));
    expect(by.get('44444444')).toBe('live');
    expect(by.get('55555555')).toBe('done');
  });
});
