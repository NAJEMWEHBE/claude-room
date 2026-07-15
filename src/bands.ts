/**
 * Per-session live band fold — sourced from our own derived event stream
 * (no hook events file needed). The roster's session rows read `last`
 * from here to place each Claude at its current bench.
 */
import type { EventLine } from './types.js';

export interface BandAction {
  tool: string;
  detail: string;
  ago_s: number;
  ok: boolean;
}
export interface SessionBand {
  session: string;
  last: BandAction | null;
}

/** Fold a rolling event buffer into { sid8 -> band }. Newest tool-bearing event
 *  per session becomes `last`. UserPromptSubmit clears the bench (idle -> podium). */
export function foldBands(events: EventLine[], nowSec: number): Map<string, SessionBand> {
  const bands = new Map<string, SessionBand>();
  // walk oldest -> newest so the last write per session wins
  for (const e of events) {
    const sid = (e.session || '').slice(0, 8);
    if (!sid) continue;
    let band = bands.get(sid);
    if (!band) {
      band = { session: sid, last: null };
      bands.set(sid, band);
    }
    if (e.event === 'PreToolUse' && e.tool) {
      band.last = {
        tool: e.tool,
        detail: (e.detail || '').slice(0, 120),
        ago_s: Math.max(0, Math.floor(nowSec - (e.ts ?? nowSec))),
        ok: e.ok !== false,
      };
    } else if (e.event === 'UserPromptSubmit') {
      band.last = null; // fresh prompt: sprite walks home to the podium
    }
  }
  return bands;
}
