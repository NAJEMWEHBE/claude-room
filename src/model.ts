/**
 * Model + job-type classification. Pure functions, no I/O.
 */

/** JOB_TYPES order matters — first regex hit wins. */
const JOB_TYPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['reviewer', /review|audit|critique|verif/],
  ['scout', /explor|search|investigat|locate|find|scan|map/],
  ['builder', /build|implement|edit|write|fix|refactor|creat/],
  ['tester', /test|run|exec|bench|measure/],
  ['researcher', /research|web|fetch|doc/],
  ['architect', /plan|design|architect/],
];

/** Classify free text into one of the seven Room job labels; 'helper' fallthrough. */
export function jobType(text: string): string {
  const t = (text || '').toLowerCase();
  for (const [name, pat] of JOB_TYPES) {
    if (pat.test(t)) return name;
  }
  return 'helper';
}

/**
 * 'claude-opus-4-8' -> 'Opus 4.8'; 'claude-sonnet-5' -> 'Sonnet 5';
 * 'claude-haiku-4-5-20251001' -> 'Haiku 4.5'; ollama 'qwen3:4b-...' -> 'qwen3'.
 * '' -> ''.
 */
export function prettyModel(mid: string | null | undefined): string {
  if (!mid) return '';
  const m = mid.startsWith('claude-') ? mid.slice(7) : mid;
  const parts = m.split('-');
  const fam = parts[0] ?? '';
  // keep 1-2 digit version tokens, drop the 8-digit date suffix
  const vers = parts.slice(1).filter((p) => /^\d+$/.test(p) && p.length <= 2);
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  if (fam && vers.length) return cap(fam) + ' ' + vers.join('.');
  if (mid.includes(':') && !mid.includes('/')) return mid.split(':')[0] ?? mid; // local ollama tag
  return fam ? cap(fam) : mid;
}

/** Last path segment of a cwd (or project-dir slug) as a short label. */
export function projLabel(p: string | null | undefined): string {
  if (!p) return '';
  const s = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const seg = s.split('/').pop() ?? '';
  return seg.slice(0, 24);
}
