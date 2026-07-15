/**
 * Wire shapes. Room.tsx consumes these two surfaces:
 *   GET /api/live-agents -> LiveAgents
 *   GET /api/stream (SSE) -> EventLine per `data:` frame
 * Keep these byte-compatible with web/src/api.ts or the frontend breaks.
 */

/** One raw event as it arrives over SSE /api/stream. Every field optional on
 *  the wire; ts is server-stamped (epoch seconds). */
export interface EventLine {
  ts?: number;
  event?: string; // "PreToolUse" | "PostToolUse" | "UserPromptSubmit"
  session?: string; // 8-char session id fragment
  tool?: string;
  detail?: string;
  ok?: boolean;
}

/** One agent in the roster.
 *  session + model are always present; project/task/tool only on kind==='session'. */
export interface LiveAgent {
  id: string;
  kind: string; // session | subagent | workflow
  session: string; // 8-char: own id, or a child's PARENT session
  name: string;
  job: string; // reviewer|scout|builder|tester|researcher|architect|helper|''
  detail: string;
  model: string;
  status: string; // live | done | failed
  age_s: number;
  project?: string; // session rows only
  task?: string; // session rows only
  tool?: string; // session rows only
}

/** GET /api/live-agents envelope. */
export interface LiveAgents {
  agents: LiveAgent[];
  live: number;
  done_recent: number;
  ts: number;
}
