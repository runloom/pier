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
import {
  agentUsesSkillColonInvoke,
  skillInvokeText,
} from "@shared/skill-invoke.ts";

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
 * Canonical force-invoke id: frontmatter `name` when it is a valid skill
 * identifier token (Codex/Grok resolve by name), otherwise directory /
 * managed id. Free-form display labels with spaces are not invocable ids.
 */
function skillInvocationId(skill: {
  directoryName?: string;
  id?: string;
  name: string;
}): string {
  const fromName = skill.name.trim();
  if (
    fromName.length > 0 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(fromName)
  ) {
    return fromName;
  }
  return (skill.id ?? skill.directoryName ?? "").trim();
}

/**
 * Grok: when a skill bare name collides with a built-in, the built-in keeps
 * `/name` and the skill is advertised under a scope-qualified form
 * (`/user:name`, `/repo:name`). Project/unmanaged/bundled → repo scope.
 */
function grokQualifiedSkillInvoke(
  bareId: string,
  source: ComposerSkillSource
): string {
  if (source === "user-global") {
    return `/user:${bareId}`;
  }
  return `/repo:${bareId}`;
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
 *    the literal `/id`.
 * 4. Skills with `userInvocable: false` are excluded (Grok slash menu rule).
 *
 * Collision with built-ins:
 * - Default (most agents): disk/bundled skills with the same invoke text win.
 * - Grok: built-in keeps bare `/id`; colliding skills use qualified invoke.
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
  const builtinCommands =
    options?.builtinCommands ?? listBuiltinCommands(agentKind);
  const builtinIds = new Set(
    builtinCommands.map((c) => c.id).filter((id) => id.length > 0)
  );

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
    if (skill.userInvocable === false) {
      continue;
    }
    if (!effectInvocable(skill.effects, agentKind)) {
      continue;
    }
    const id = skillInvocationId(skill);
    if (id.length === 0) {
      continue;
    }
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
    if (skill.userInvocable === false) {
      continue;
    }
    if (!effectInvocable(skill.effects, agentKind)) {
      continue;
    }
    const id = skillInvocationId(skill);
    if (id.length === 0) {
      continue;
    }
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
    if (skill.userInvocable === false) {
      continue;
    }
    if (!effectInvocable(skill.effects, agentKind)) {
      continue;
    }
    const id = skillInvocationId({ id: skill.id, name: skill.name });
    if (id.length === 0) {
      continue;
    }
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

  // Grok: bare name collisions keep the built-in; skill uses qualified form.
  if (agentKind === "grok") {
    for (const [id, item] of byId) {
      if (!builtinIds.has(id)) {
        continue;
      }
      const bare = invoke(id);
      if (bare == null || item.invokeText !== bare) {
        continue;
      }
      byId.set(id, {
        ...item,
        invokeText: grokQualifiedSkillInvoke(id, item.source),
      });
    }
  }

  let skills = [...byId.values()];
  const usedInvokeText = new Set(skills.map((item) => item.invokeText));
  const commands: ComposerSkillSuggestItem[] = [];
  for (const command of builtinCommands) {
    // Commands are always the agent's literal slash syntax (Codex included:
    // `$` is skill-only). Non-Grok: disk/bundled skills with the same invoke
    // text win. Grok: built-ins always keep the bare form (skills qualified).
    const text = `/${command.id}`;
    if (command.id.length === 0) {
      continue;
    }
    if (agentKind !== "grok" && usedInvokeText.has(text)) {
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
  skills = skills.sort(byIdLocale);
  return [...commands, ...skills];
}

export { filterComposerSkillSuggestItems } from "./composer-skill-rank.ts";

/**
 * Slash-namespace prefixes (`/skills …`, OMP/Pi `/skill:`) only list skills.
 * Preserve / keyboard nav must use this same list as the popup.
 */
export function visibleComposerSkillSuggestItems(
  items: readonly ComposerSkillSuggestItem[],
  skillNamespace: boolean
): ComposerSkillSuggestItem[] {
  if (!skillNamespace) {
    return [...items];
  }
  return items.filter((item) => item.source !== "builtin-command");
}

/** Keep the highlighted row across a same-query catalog refresh. */
export function preserveSuggestActiveIndex(
  prevIndex: number,
  prevItems: readonly { id: string }[],
  nextItems: readonly { id: string }[]
): number {
  if (nextItems.length === 0) {
    return 0;
  }
  const selectedId = prevItems[prevIndex]?.id;
  if (selectedId !== undefined) {
    const next = nextItems.findIndex((item) => item.id === selectedId);
    if (next >= 0) {
      return next;
    }
  }
  return Math.min(prevIndex, nextItems.length - 1);
}

export interface SkillSuggestMatch {
  matchingString: string;
  /**
   * True when the typed prefix is a skill-only namespace (Goose `/skills …`
   * or OMP/Pi `/skill:` / `/skill`). Commands stay hidden in that mode.
   */
  skillNamespace: boolean;
  trigger: "/";
}

function analyzeSlashSuggest(
  text: string,
  agentKind?: string | null
): {
  leadOffset: number;
  endOffset: number;
  matchingString: string;
  skillNamespace: boolean;
} | null {
  // Goose `/skills [id]` — query is the skill token, not "skills".
  const goose = text.match(/^(\s*)\/skills(?:\s+([a-z0-9-]*))?$/i);
  if (goose) {
    const ws = goose[1] ?? "";
    return {
      endOffset: text.length,
      leadOffset: ws.length,
      matchingString: goose[2] ?? "",
      skillNamespace: true,
    };
  }
  // OMP / Pi only: `/skill:` is not in the generic id charset. Other agents
  // (Command Code `/skill:name` collision bypass) must PTY-passthrough.
  if (agentUsesSkillColonInvoke(agentKind)) {
    const colon = text.match(/^(\s*)\/skill:([a-z0-9-]*)$/i);
    if (colon) {
      const ws = colon[1] ?? "";
      return {
        endOffset: text.length,
        leadOffset: ws.length,
        matchingString: colon[2] ?? "",
        skillNamespace: true,
      };
    }
    const bareSkill = text.match(/^(\s*)\/skill$/i);
    if (bareSkill) {
      const ws = bareSkill[1] ?? "";
      return {
        endOffset: text.length,
        leadOffset: ws.length,
        matchingString: "",
        skillNamespace: true,
      };
    }
  }
  const match = text.match(/^(\s*)\/([a-z0-9-]*)$/i);
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
    skillNamespace: false,
  };
}

/**
 * Match `/` skill/command trigger for Enhanced Input.
 *
 * **Message-start only** (optional leading whitespace). Also accepts Goose’s
 * progressive form `/skills` + optional skill id token (space-separated), and
 * OMP/Pi `/skill:` / `/skill`.
 */
export function getSkillSuggestMatch(
  plainPrefix: string,
  agentKind?: string | null
): SkillSuggestMatch | null {
  const analyzed = analyzeSlashSuggest(plainPrefix, agentKind);
  if (!analyzed) {
    return null;
  }
  return {
    matchingString: analyzed.matchingString,
    skillNamespace: analyzed.skillNamespace,
    trigger: "/",
  };
}

/**
 * Node-local slash span for replacement after {@link getSkillSuggestMatch} hits.
 * Covers bare `/id`, Goose `/skills [id]`, and OMP/Pi `/skill:` / `/skill`.
 */
export function getSkillSuggestNodeReplaceRange(
  nodeText: string,
  cursorInNode: number,
  agentKind?: string | null
): { leadOffset: number; endOffset: number; matchingString: string } | null {
  const before = nodeText.slice(0, cursorInNode);
  const analyzed = analyzeSlashSuggest(before, agentKind);
  if (!analyzed) {
    return null;
  }
  return {
    endOffset: analyzed.endOffset,
    leadOffset: analyzed.leadOffset,
    matchingString: analyzed.matchingString,
  };
}
