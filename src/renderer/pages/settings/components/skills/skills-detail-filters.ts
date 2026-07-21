import type {
  ProjectSkillView,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import type { SkillsFilterId } from "./skills-detail-toolbar.tsx";

/**
 * Unified-list search/filter predicates (design v9 §7.3 / §7.12).
 */

export function filterManagedSkills(args: {
  skills: readonly ProjectSkillView[];
  filter: SkillsFilterId;
  query: string;
}): ProjectSkillView[] {
  if (args.filter === "project" || args.filter === "user-global") {
    return [];
  }
  const q = args.query.trim().toLowerCase();
  return args.skills.filter((skill) => {
    // "Managed by me" is user-owned library skills only; Pier system skills
    // remain visible under All.
    if (args.filter === "managed" && skill.managedBy !== "user") {
      return false;
    }
    if (!q) return true;
    return (
      skill.id.toLowerCase().includes(q) ||
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q)
    );
  });
}

/** Unmanaged project-directory rows (layer 5) belong to the "project" bucket. */
export function filterUnmanagedRows(args: {
  entries: readonly UnmanagedSkillView[];
  filter: SkillsFilterId;
  query: string;
}): UnmanagedSkillView[] {
  if (args.filter !== "all" && args.filter !== "project") return [];
  return matchReadOnly(args.entries, args.query);
}

/** User-global rows (layer 3) belong to the "user-global" bucket. */
export function filterUserGlobalRows(args: {
  entries: readonly UserGlobalSkillView[];
  filter: SkillsFilterId;
  query: string;
}): UserGlobalSkillView[] {
  if (args.filter !== "all" && args.filter !== "user-global") return [];
  return matchReadOnly(args.entries, args.query);
}

function matchReadOnly<T extends UnmanagedSkillView | UserGlobalSkillView>(
  entries: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!q) return true;
    return (
      entry.directoryName.toLowerCase().includes(q) ||
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q)
    );
  });
}
