import type {
  ProjectSkillView,
  SkillEffectiveCell,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { skillInvokeText } from "@shared/skill-invoke.ts";

/** Where the skill was discovered (UI badge only). */
export type ComposerSkillSource =
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
 * Build skill suggestions for one agent from a skills snapshot.
 *
 * Inclusion rules (product: show skills the user can insert, not only matrix
 * "healthy" cells):
 * 1. Managed + enabled → always listed (user turned them on; projection lag
 *    or Claude-only roots must not empty the picker).
 * 2. Unmanaged / user-global → only when effect is discoverable or duplicate.
 * 3. Agent not in skill adapters → fall back to enabled managed + all
 *    unmanaged + user-global (best-effort invoke prefix).
 * Same skill id: managed project > unmanaged project > user-global.
 */
export function buildComposerSkillSuggestItems(
  snapshot: ComposerSkillSuggestSnapshotInput,
  agentKind: string
): ComposerSkillSuggestItem[] {
  const invoke = (id: string): string | null => skillInvokeText(agentKind, id);
  const byId = new Map<string, ComposerSkillSuggestItem>();
  const agentUnknown = agentAbsentFromMatrix(snapshot, agentKind);

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
