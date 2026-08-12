import {
  type AgentBuiltinCommand,
  type AgentBundledSkill,
  listBuiltinCommands,
  listBundledSkills,
} from "@shared/agent-surfaces/index.ts";
import type {
  ProjectSkillView,
  SkillEffectiveCell,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { skillInvokeText } from "@shared/skill-invoke.ts";

/**
 * Where the entry was discovered (UI badge only).
 * L1 invocable catalog: disk layers + adapter bundled + documented
 * built-in commands (never host/Grok roots).
 */
export type ComposerSkillSource =
  | "builtin-command"
  | "bundled"
  | "project"
  | "project-unmanaged"
  | "user-global";

export interface ComposerSkillSuggestItem {
  description: string;
  /** Directory / manifest id — used in invoke text. */
  id: string;
  invokeText: string;
  /** Display name from frontmatter; falls back to id. */
  label: string;
  source: ComposerSkillSource;
}

export interface ComposerSkillSuggestSnapshotInput {
  skills: readonly ProjectSkillView[];
  unmanagedSkills: readonly UnmanagedSkillView[];
  userGlobalSkills: readonly UserGlobalSkillView[];
}

export interface BuildComposerSkillSuggestOptions {
  /**
   * Override built-in command table (tests).
   * Default: {@link listBuiltinCommands}(agentKind).
   */
  builtinCommands?: readonly AgentBuiltinCommand[];
  /**
   * Override bundled table (tests). Default: {@link listBundledSkills}(agentKind).
   */
  bundled?: readonly AgentBundledSkill[];
}

/**
 * States where this agent can force-invoke the skill by name right now.
 * - discoverable: unique visible copy under an agent-readable root
 * - duplicate: multiple copies, but `/name` / `$name` still works
 *
 * Strict L1 excludes shadowed / not-projected / not-applicable so Pier does
 * not list skills the foreground agent cannot actually load.
 */
function effectInvocable(
  effects: readonly SkillEffectiveCell[],
  agentKind: string
): boolean {
  for (const cell of effects) {
    if (cell.agentKind !== agentKind) {
      continue;
    }
    const state = cell.effect.state;
    if (state === "discoverable" || state === "duplicate") {
      return true;
    }
  }
  return false;
}

/**
 * Build skill suggestions for one agent (L1 invocable catalog).
 *
 * Inclusion (strict — list only what this agent can force-invoke):
 * 0. Adapter **bundled** skills (host surface table for this kind).
 * 1. Managed → **enabled** and matrix **discoverable/duplicate** for this agent
 *    (not-projected / disabled / absent-from-matrix are excluded).
 * 2. Unmanaged / user-global → discoverable or duplicate for this agent only.
 * 3. Documented **built-in commands** (agent-surfaces/<kind>); insert text is
 *    the literal `/id`; disk/bundled skills with the same invoke text win.
 *
 * No wide dump when the agent has zero matrix cells — only surface bundled +
 * commands remain (avoids “Pier lists it, agent ignores it”).
 *
 * Same id precedence (later wins): bundled < user-global < unmanaged < managed
 * so disk / Pier-managed overrides bundled (Claude personal/project override).
 * Host/Grok roots are never sources here.
 */
export function buildComposerSkillSuggestItems(
  snapshot: ComposerSkillSuggestSnapshotInput,
  agentKind: string,
  options?: BuildComposerSkillSuggestOptions
): ComposerSkillSuggestItem[] {
  const invoke = (id: string): string | null => skillInvokeText(agentKind, id);
  const byId = new Map<string, ComposerSkillSuggestItem>();
  const bundled = options?.bundled ?? listBundledSkills(agentKind);

  for (const skill of bundled) {
    const id = skill.id;
    const text = invoke(id);
    if (text == null) {
      continue;
    }
    const label =
      skill.label != null && skill.label.trim().length > 0
        ? skill.label.trim()
        : id;
    byId.set(id, {
      description: skill.description,
      id,
      invokeText: text,
      label,
      source: "bundled",
    });
  }

  for (const skill of snapshot.userGlobalSkills) {
    if (!effectInvocable(skill.effects, agentKind)) {
      continue;
    }
    const id = skill.directoryName;
    const text = invoke(id);
    if (text == null) {
      continue;
    }
    byId.set(id, {
      description: skill.description,
      id,
      invokeText: text,
      label: skill.name.trim().length > 0 ? skill.name : id,
      source: "user-global",
    });
  }

  for (const skill of snapshot.unmanagedSkills) {
    if (!effectInvocable(skill.effects, agentKind)) {
      continue;
    }
    const id = skill.directoryName;
    const text = invoke(id);
    if (text == null) {
      continue;
    }
    byId.set(id, {
      description: skill.description,
      id,
      invokeText: text,
      label: skill.name.trim().length > 0 ? skill.name : id,
      source: "project-unmanaged",
    });
  }

  for (const skill of snapshot.skills) {
    // Strict: must be enabled AND projected as invocable for this agent.
    if (skill.enabled !== true) {
      continue;
    }
    if (!effectInvocable(skill.effects, agentKind)) {
      continue;
    }
    const id = skill.id;
    const text = invoke(id);
    if (text == null) {
      continue;
    }
    byId.set(id, {
      description: skill.description,
      id,
      invokeText: text,
      label: skill.name.trim().length > 0 ? skill.name : id,
      source: "project",
    });
  }

  const skills = [...byId.values()];
  const usedInvokeText = new Set(skills.map((item) => item.invokeText));
  const commands: ComposerSkillSuggestItem[] = [];
  const builtinCommands =
    options?.builtinCommands ?? listBuiltinCommands(agentKind);
  for (const command of builtinCommands) {
    // Commands are always the agent's literal slash syntax (Codex included:
    // `$` is skill-only). Disk/bundled skills with the same invoke text win.
    const text = `/${command.id}`;
    if (command.id.length === 0 || usedInvokeText.has(text)) {
      continue;
    }
    usedInvokeText.add(text);
    commands.push({
      description: command.description,
      id: command.id,
      invokeText: text,
      label: command.id,
      source: "builtin-command",
    });
  }

  // Commands first (system slash surface), then skills — each group by id.
  // Interleaving by id alone mixes SquareSlash and Zap rows and feels chaotic.
  const byIdLocale = (
    a: ComposerSkillSuggestItem,
    b: ComposerSkillSuggestItem
  ) => a.id.localeCompare(b.id);
  commands.sort(byIdLocale);
  skills.sort(byIdLocale);
  return [...commands, ...skills];
}

/** Case-insensitive filter over id / label / description. */
export function filterComposerSkillSuggestItems(
  items: readonly ComposerSkillSuggestItem[],
  query: string
): ComposerSkillSuggestItem[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return [...items];
  }
  return items.filter((item) => {
    if (item.id.toLowerCase().includes(normalized)) {
      return true;
    }
    if (item.label.toLowerCase().includes(normalized)) {
      return true;
    }
    if (item.description.toLowerCase().includes(normalized)) {
      return true;
    }
    return false;
  });
}

/**
 * Match `/` skill/command trigger for Enhanced Input.
 *
 * **Message-start only** (optional leading whitespace). Agent TUIs force-invoke
 * `/cmd` and skills at the start of a turn; mid-message `use /plan` is free text
 * and must not open the catalog.
 *
 * Pass the agent-facing plain-text prefix from composer start through the caret
 * (not a mid-node fragment alone). `$` never opens the picker (Codex still
 * **inserts** `$id` after pick).
 *
 * Selection inserts agent-correct invokeText via skillInvokeText()
 * (`/id` or `$id` depending on the foreground agent) — never a library path.
 */
export function getSkillSuggestMatch(
  plainPrefix: string
): { matchingString: string; trigger: "/" } | null {
  const match = plainPrefix.match(/^\s*\/([a-z0-9-]*)$/i);
  if (!match) {
    return null;
  }
  return {
    matchingString: match[1] ?? "",
    trigger: "/",
  };
}

/**
 * Node-local slash span for replacement after {@link getSkillSuggestMatch} hits.
 * Returns null when the current text node is not the whole leading slash token
 * (e.g. caret not on that node).
 */
export function getSkillSuggestNodeReplaceRange(
  nodeText: string,
  cursorInNode: number
): { leadOffset: number; endOffset: number; matchingString: string } | null {
  const before = nodeText.slice(0, cursorInNode);
  const match = before.match(/^(\s*)\/([a-z0-9-]*)$/i);
  if (!match) {
    return null;
  }
  const ws = match[1] ?? "";
  const query = match[2] ?? "";
  const leadOffset = ws.length;
  return {
    endOffset: leadOffset + 1 + query.length,
    leadOffset,
    matchingString: query,
  };
}
