/**
 * Roster assembler — the /api/live-agents payload.
 * v0.1 scope: sessions + native/workflow subagents only.
 */
import { scanSessions, scanSubagents } from './transcript.js';
import { foldBands } from './bands.js';
import type { EventLine, LiveAgent, LiveAgents } from './types.js';

const DONE_RECENT_S = 300;

export async function buildRoster(events: EventLine[], now = Date.now() / 1000): Promise<LiveAgents> {
  const bands = foldBands(events, now);
  const [sessions, subs] = await Promise.all([scanSessions(now, bands), scanSubagents(now)]);
  const agents: LiveAgent[] = [...sessions, ...subs];
  for (const a of agents) {
    // uniform wire shape — every row carries session + model
    if (a.session == null) a.session = '';
    if (a.model == null) a.model = '';
  }
  const live = agents.filter((a) => a.status === 'live').length;
  const done_recent = agents.filter((a) => a.status !== 'live' && a.age_s <= DONE_RECENT_S).length;
  return { agents, live, done_recent, ts: now };
}
