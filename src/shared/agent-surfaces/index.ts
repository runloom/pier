/**
 * Agent composer-surface registry.
 *
 * Each agent kind owns `agent-surfaces/<kind>.ts`. This module only merges
 * them for lookup. Palette-driven CLIs (amp, crush) intentionally have no
 * entry — free-typed `/xxx` still reaches the PTY via Enter passthrough.
 */
import { aiderComposerSurface } from "./aider.ts";
import { claudeComposerSurface } from "./claude.ts";
import { clineComposerSurface } from "./cline.ts";
import { codebuddyComposerSurface } from "./codebuddy.ts";
import { codexComposerSurface } from "./codex.ts";
import { commandCodeComposerSurface } from "./command-code.ts";
import { continueComposerSurface } from "./continue.ts";
import { copilotComposerSurface } from "./copilot.ts";
import { cursorComposerSurface } from "./cursor.ts";
import { droidComposerSurface } from "./droid.ts";
import { geminiComposerSurface } from "./gemini.ts";
import { gooseComposerSurface } from "./goose.ts";
import { grokComposerSurface } from "./grok.ts";
import { kiloComposerSurface } from "./kilo.ts";
import { kimiComposerSurface } from "./kimi.ts";
import { ompComposerSurface } from "./omp.ts";
import { opencodeComposerSurface } from "./opencode.ts";
import { piComposerSurface } from "./pi.ts";
import { qwenCodeComposerSurface } from "./qwen-code.ts";
import {
  type AgentBuiltinCommand,
  type AgentBundledSkill,
  EMPTY_COMPOSER_SURFACE,
  type ResolvedAgentComposerSurface,
} from "./types.ts";

export type {
  AgentBuiltinCommand,
  AgentBundledSkill,
  AgentComposerSurface,
  ResolvedAgentComposerSurface,
} from "./types.ts";
export {
  defineComposerSurface,
  EMPTY_COMPOSER_SURFACE,
} from "./types.ts";

const BY_AGENT: Readonly<Record<string, ResolvedAgentComposerSurface>> = {
  aider: aiderComposerSurface,
  claude: claudeComposerSurface,
  cline: clineComposerSurface,
  codebuddy: codebuddyComposerSurface,
  "command-code": commandCodeComposerSurface,
  codex: codexComposerSurface,
  continue: continueComposerSurface,
  copilot: copilotComposerSurface,
  cursor: cursorComposerSurface,
  droid: droidComposerSurface,
  gemini: geminiComposerSurface,
  goose: gooseComposerSurface,
  grok: grokComposerSurface,
  kilo: kiloComposerSurface,
  kimi: kimiComposerSurface,
  omp: ompComposerSurface,
  opencode: opencodeComposerSurface,
  /** openclaude shares Claude Code's slash/skill surface. */
  openclaude: claudeComposerSurface,
  pi: piComposerSurface,
  "qwen-code": qwenCodeComposerSurface,
};

/** Full composer surface for one foreground agent kind. */
export function getAgentComposerSurface(
  agentKind: string | null | undefined
): ResolvedAgentComposerSurface {
  if (typeof agentKind !== "string" || agentKind.length === 0) {
    return EMPTY_COMPOSER_SURFACE;
  }
  return BY_AGENT[agentKind] ?? EMPTY_COMPOSER_SURFACE;
}

/** Built-in slash commands for one foreground agent kind. */
export function listBuiltinCommands(
  agentKind: string | null | undefined
): readonly AgentBuiltinCommand[] {
  return getAgentComposerSurface(agentKind).builtinCommands;
}

/** Runtime-bundled skills for one foreground agent kind. */
export function listBundledSkills(
  agentKind: string | null | undefined
): readonly AgentBundledSkill[] {
  return getAgentComposerSurface(agentKind).bundledSkills;
}

/**
 * Agent kinds with an explicit composer surface registration
 * (including empty-equivalent absences only when not listed — amp/crush).
 */
export function listComposerSurfaceAgentKinds(): readonly string[] {
  return Object.keys(BY_AGENT).sort((a, b) => a.localeCompare(b));
}
