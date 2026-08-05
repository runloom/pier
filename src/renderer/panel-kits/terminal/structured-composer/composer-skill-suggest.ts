import {
  type AgentBundledSkill,
  listBundledSkills,
} from "@shared/agent-bundled-skills.ts";
import type {
  ProjectSkillView,
  SkillEffectiveCell,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { skillInvokeText } from "@shared/skill-invoke.ts";

/**
 * Where the skill was discovered (UI badge only).
 * L1 invocable catalog: disk layers + adapter bundled (never host/Grok roots).
 */
export type ComposerSkillSource =
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
   * Override bundled table (tests). Default: {@link listBundledSkills}(agentKind).
   */
  bundled?: readonly AgentBundledSkill[];
}

/**
 * States where the agent can still invoke the skill by name.
 * - discoverable: unique visible copy
 * - duplicate: multiple copies, but `/name` / `$name` still works
 *
 * Shadowed / not-projected / not-applicable are excluded for discovered rows.
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

/** True when this agent has no matrix cells at all (not in skill adapters). */
function agentAbsentFromMatrix(
  snapshot: ComposerSkillSuggestSnapshotInput,
  agentKind: string
): boolean {
  for (const skill of snapshot.skills) {
    if (skill.effects.some((cell) => cell.agentKind === agentKind)) {
      return false;
    }
  }
  for (const skill of snapshot.unmanagedSkills) {
    if (skill.effects.some((cell) => cell.agentKind === agentKind)) {
      return false;
    }
  }
  for (const skill of snapshot.userGlobalSkills) {
    if (skill.effects.some((cell) => cell.agentKind === agentKind)) {
      return false;
    }
  }
  return true;
}

/**
 * Build skill suggestions for one agent (L1 invocable catalog).
 *
 * Inclusion:
 * 0. Adapter **bundled** skills (runtime built-ins; not on disk).
 * 1. Managed + enabled → always listed (projection lag must not empty picker).
 * 2. Unmanaged / user-global → discoverable or duplicate for this agent.
 * 3. Agent absent from matrix → enabled managed + all unmanaged + user-global.
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
  const agentUnknown = agentAbsentFromMatrix(snapshot, agentKind);
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
    if (!(agentUnknown || effectInvocable(skill.effects, agentKind))) {
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
    if (!(agentUnknown || effectInvocable(skill.effects, agentKind))) {
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
    // Enabled managed always listed (user turned them on). Also list when
    // matrix says discoverable/duplicate even if disabled (edge cases).
    const invocable = effectInvocable(skill.effects, agentKind);
    if (!(skill.enabled === true || invocable)) {
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

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
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
 * Match `/` skill trigger before the caret.
 * Selection inserts agent-correct invokeText via skillInvokeText()
 * (`/id` or `$id` depending on the foreground agent).
 */
export function getSkillSuggestMatch(
  text: string,
  cursor: number
): { leadOffset: number; matchingString: string; trigger: "/" } | null {
  const before = text.slice(0, cursor);
  // Slash only; do not treat mid-path segments (e.g. foo/bar) as triggers —
  // require whitespace/start/( boundary before `/`.
  const match = before.match(/(^|[\s([{])\/([a-z0-9-]*)$/i);
  if (!match || match.index === undefined) {
    return null;
  }
  const leadOffset = match.index + (match[1] ?? "").length;
  return {
    leadOffset,
    matchingString: match[2] ?? "",
    trigger: "/",
  };
}
