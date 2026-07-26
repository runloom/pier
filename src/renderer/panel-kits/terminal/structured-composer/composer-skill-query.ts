import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import {
  isProjectSummary,
  normalizeSnapshot,
} from "@/stores/project-skills-model.ts";
import {
  buildComposerSkillSuggestItems,
  type ComposerSkillSuggestItem,
  filterComposerSkillSuggestItems,
} from "./composer-skill-suggest.ts";

export type ComposerSkillQueryStatus = "idle" | "loading" | "done" | "error";

export interface ComposerSkillQuerySnapshot {
  items: readonly ComposerSkillSuggestItem[];
  status: ComposerSkillQueryStatus;
}

interface CacheEntry {
  itemsByAgent: Map<string, ComposerSkillSuggestItem[]>;
  loadedAt: number;
  projectRootPath: string;
}

const CACHE_TTL_MS = 30_000;
let cache: CacheEntry | null = null;
let invalidateAttached = false;

function ensureInvalidationListener(): void {
  if (invalidateAttached) {
    return;
  }
  invalidateAttached = true;
  const api = window.pier?.projectSkills;
  if (!api?.onInvalidated) {
    return;
  }
  api.onInvalidated(() => {
    cache = null;
  });
}

function pathsLikelySame(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const norm = (p: string) => p.replace(/\/+$/, "").toLowerCase();
  if (norm(a) === norm(b)) {
    return true;
  }
  // Suffix match handles worktree/cwd vs git-root realPath differences.
  return norm(a).endsWith(norm(b)) || norm(b).endsWith(norm(a));
}

async function resolveProjectRef(
  projectRootPath: string
): Promise<ProjectRootRef | null> {
  const projects =
    await window.pier.projectSkills.projectsSnapshot(projectRootPath);
  const list = Array.isArray(projects) ? projects.filter(isProjectSummary) : [];
  if (list.length === 0) {
    return null;
  }
  // projectsSnapshot prepends the override path as the first entry.
  const exact = list.find(
    (entry) =>
      pathsLikelySame(entry.projectRef.realPath, projectRootPath) ||
      pathsLikelySame(entry.displayPath, projectRootPath)
  );
  return exact?.projectRef ?? list[0]?.projectRef ?? null;
}

async function loadItemsForAgent(
  projectRootPath: string,
  agentKind: string
): Promise<ComposerSkillSuggestItem[]> {
  ensureInvalidationListener();
  const now = Date.now();
  if (
    cache &&
    cache.projectRootPath === projectRootPath &&
    now - cache.loadedAt < CACHE_TTL_MS
  ) {
    const hit = cache.itemsByAgent.get(agentKind);
    if (hit) {
      return hit;
    }
  }

  const projectRef = await resolveProjectRef(projectRootPath);
  if (!projectRef) {
    return [];
  }
  const raw = await window.pier.projectSkills.snapshot(projectRef);
  const snapshot = normalizeSnapshot(raw);
  if (!snapshot) {
    return [];
  }

  const items = buildComposerSkillSuggestItems(snapshot, agentKind);
  if (
    !(
      cache &&
      cache.projectRootPath === projectRootPath &&
      now - cache.loadedAt < CACHE_TTL_MS
    )
  ) {
    cache = {
      itemsByAgent: new Map(),
      loadedAt: now,
      projectRootPath,
    };
  }
  cache.itemsByAgent.set(agentKind, items);
  return items;
}

/**
 * Debounced skill list client for the composer skill popup.
 * Mirrors composer-path-query: search() returns a cancel function.
 */
export function createComposerSkillQueryClient(): {
  dispose: () => void;
  search: (args: {
    agentKind: string;
    onUpdate: (snap: ComposerSkillQuerySnapshot) => void;
    projectRootPath: string;
    query: string;
  }) => () => void;
} {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestId = 0;

  return {
    dispose: () => {
      disposed = true;
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    search: ({ agentKind, onUpdate, projectRootPath, query }) => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      const id = ++requestId;
      onUpdate({ items: [], status: "loading" });

      timer = setTimeout(() => {
        timer = null;
        loadItemsForAgent(projectRootPath, agentKind)
          .then((all) => {
            if (disposed || id !== requestId) {
              return;
            }
            const items = filterComposerSkillSuggestItems(all, query);
            onUpdate({ items, status: "done" });
          })
          .catch(() => {
            if (disposed || id !== requestId) {
              return;
            }
            onUpdate({ items: [], status: "error" });
          });
      }, 80);

      return () => {
        if (timer != null) {
          clearTimeout(timer);
          timer = null;
        }
        // Bump so in-flight results are ignored.
        requestId += 1;
      };
    },
  };
}

/** Test helper: drop TTL cache between unit tests. */
export function resetComposerSkillQueryCacheForTests(): void {
  cache = null;
}
