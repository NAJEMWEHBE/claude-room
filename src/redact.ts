/**
 * Detail redaction — read-only safety net. The Room never needs the full
 * argument of a tool call, only a short human hint of what bench Claude is at.
 * We (a) collapse absolute paths to their basename and (b) mask token-shaped
 * secrets, so no key/path leaks onto the SSE wire or the roster. Ports MC's
 * redaction *idea* (server.append_event's secret sink) to the derivation layer.
 */

// token-shaped runs we never want on the wire (keys, bearer tokens, long hex)
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|xox[baprs])[-_][A-Za-z0-9]{16,}\b/g, // api keys / gh / slack
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
  /\beyJ[A-Za-z0-9._-]{20,}\b/g, // JWT
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex (sha/token)
  /\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, // AWS access key id
];

/** Collapse a win/posix absolute path to its final segment. Leaves relative
 *  hints (e.g. "src/foo.ts") mostly intact but trims their leading dirs too. */
function stripPaths(s: string): string {
  // windows drive paths: C:\a\b\c.ts  or  C:/a/b/c.ts
  s = s.replace(/[A-Za-z]:[\\/](?:[^\s\\/:*?"<>|]+[\\/])*([^\s\\/:*?"<>|]+)/g, '$1');
  // posix absolute paths: /a/b/c.ts
  s = s.replace(/(?:^|\s)\/(?:[^\s/]+\/)*([^\s/]+)/g, ' $1');
  // UNC / remaining deep relative: a/b/c/d -> d (only when 3+ segments)
  s = s.replace(/\b(?:[^\s\\/]+[\\/]){3,}([^\s\\/]+)/g, '$1');
  return s;
}

export function redact(detail: string): string {
  if (!detail) return '';
  let s = detail;
  for (const re of SECRET_PATTERNS) s = s.replace(re, '<redacted>');
  s = stripPaths(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, 120);
}
