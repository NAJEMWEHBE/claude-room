---
id: T06
title: Release — version bump, README/gif refresh, npm publish (Nino-gated)
type: task
status: closed
assignee: fable-2026-07-17
blocked-by: [T05]
map: ../map-alive-room.md
---

## Question

Ship it. Blocked until the build (T05) is closed and judged:

- decide version bump (minor — new visible feature) and changelog line;
- refresh README "What you're looking at" + hero gif / social preview to show the new
  anims (scope per the fog note on the map — sharpen when anims exist);
- secret-scan, commit, publish to npm using the 2FA flow in brain
  `npm-first-publish-2fa-flow`;
- **gate:** commit + publish only on Nino's explicit go (AskUserQuestion confirm) — map
  destination authorizes the work, not the button-press.

Answer = published version, links, what the demo assets show.

## Answer (2026-07-17)

**Published: claude-room 0.2.0** (minor — new visible feature).

- npm: https://www.npmjs.com/package/claude-room (0.2.0 live 05:52 UTC; tarball
  verified to ship `dist/cli.js` + built `web/dist` containing the anim code)
- Release: https://github.com/NAJEMWEHBE/claude-room/releases/tag/v0.2.0
  (publish.yml OIDC run 29558430270, green — typecheck + 36/36 tests + publish)
- Commits: `fb38c82` feat anims · `a527183` wayfinder tracker · `6035b4d` release 0.2.0
- Nino gate: AskUserQuestion — "Ship it" + "commit wayfinder" (2026-07-17).

Demo assets (captured off the fixture mock, which gained an idle `night-shift`
session to make the sleep path reproducible):

- `docs/hero.png` 3840×2160 — hammer mid-swing at WORKBENCH, Zzz sleeper at
  podium (closed eyes + drifting Zs), typing builder at TERMINAL.
- `docs/claude-room.gif` 960×540 @10fps, ~26s (2.0MB) — full mock cycle: burst
  typing, hammer + sparks, SSE walks, ✓/✗ toasts + confetti + failure shake,
  sleeping session under drifting Zs.
- `docs/social-preview.png` 1280×640 — crop of the hero (set in repo settings
  by hand; GitHub doesn't take it from the repo).

Capture gotcha for next time: a second tab in the same headless Chrome makes
the first tab `document.hidden` → the zero-idle law freezes the canvas → blank
frames. One page per browser instance when capturing.
