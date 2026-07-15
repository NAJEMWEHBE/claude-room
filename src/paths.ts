/**
 * Cross-platform resolution of the Claude Code state dir. On every OS the
 * transcripts live under ~/.claude/projects (win: C:\Users\<u>\.claude\projects).
 * CLAUDE_CONFIG_DIR override is honoured (matches the CLI's own env hook).
 */
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR
  ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
  : path.join(os.homedir(), '.claude');

export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
