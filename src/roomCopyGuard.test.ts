// roomCopyGuard.test.ts — the room-reunify NO-SILENT-COPY guard (ticket 05, MC twin:
// mission-control/tests/test_no_room_copy.py). The Room module lives ONLY in the
// the-room submodule; any copy of its files or signature code in app-owned source
// (web/src shell, backend src) is a silent re-fork and must go red. Build outputs
// (dist/, web/dist/) are exempt: a COMPILED room in the bundle is consumption.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(__dirname, '..')
const SUBMODULE = join(REPO, 'the-room')
// app-owned source trees (NOT the submodule, NOT build outputs)
const SCAN_ROOTS = [join(REPO, 'src'), join(REPO, 'web', 'src')]

// filenames that ARE the module, unambiguously (Room.tsx/room.css excluded — a host
// wrapper pair with those names is legitimate, MC precedent; signatures catch real copies)
const MODULE_FILENAMES = new Set(['roomEngine.ts', 'roomEngine.test.ts'])
// source-text signatures that live ONLY in module source (renamed copies still carry them):
// engine internals, the shell's relative engine import, the floor css's stage selector.
const MODULE_SIGNATURES = ['JOB_META', 'zoneBotCap', 'GATE_STAGGER', './roomEngine', '.rm-stage']
const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.css']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(join(dir, e.name))
    return [join(dir, e.name)]
  })
}

const appFiles = () => SCAN_ROOTS.flatMap(walk).filter((p) => p !== __filename)

describe('no-silent-copy guard (room-reunify ticket 05)', () => {
  it('the-room submodule is present and populated', () => {
    // a deleted/empty submodule invites "just copy the files back in" — guard the guard
    expect(
      existsSync(join(SUBMODULE, 'src', 'roomEngine.ts')),
      'the-room submodule missing/empty — run `git submodule update --init`; NEVER copy Room files into the app instead',
    ).toBe(true)
  })

  it('no module filenames in app-owned source', () => {
    const hits = appFiles().filter((p) => MODULE_FILENAMES.has(p.split(/[\\/]/).pop()!))
    expect(hits, `SILENT ROOM COPY: module file(s) in app source — the Room lives only in the-room/ (import via the 'the-room' alias)`).toEqual([])
  })

  it('no module signature code in app-owned source', () => {
    const hits: string[] = []
    for (const p of appFiles()) {
      if (!SCAN_EXTS.some((e) => p.endsWith(e))) continue
      const src = readFileSync(p, 'utf-8')
      for (const sig of MODULE_SIGNATURES) if (src.includes(sig)) hits.push(`${p} contains '${sig}'`)
    }
    expect(hits, `SILENT ROOM COPY: module signature code in app source — import from 'the-room' instead of pasting engine code`).toEqual([])
  })
})
