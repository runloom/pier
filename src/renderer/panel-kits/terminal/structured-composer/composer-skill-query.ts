import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import {
  isProjectSummary,
  normalizeSnapshot,
} from "@/stores/project-skills/model.ts";
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

/** Empty disk layers — still exposes bundled skills + built-in commands. */
function surfaceOnlyItems(agentKind: string): ComposerSkillSuggestItem[] {
  return buildComposerSkillSuggestItems(
    { skills: [], unmanagedSkills: [], userGlobalSkills: [] },
    agentKind
  );
}

function cachedItemsForAgent(
  projectRootPath: string,
  agentKind: string
): ComposerSkillSuggestItem[] | null {
  const now = Date.now();
  if (
    !(
      cache &&
      cache.projectRootPath === projectRootPath &&
      now - cache.loadedAt < CACHE_TTL_MS
    )
  ) {
    return null;
  }
  return cache.itemsByAgent.get(agentKind) ?? null;
}

/** Sync seed so `/` is never an empty loading shell. */
function seedItemsForAgent(
  projectRootPath: string,
  agentKind: string
): { complete: boolean; items: ComposerSkillSuggestItem[] } {
  const cached = cachedItemsForAgent(projectRootPath, agentKind);
  if (cached) {
    return { complete: true, items: cached };
  }
  if (!projectRootPath) {
    return {
      complete: true,
      items: rememberItems(
        projectRootPath,
        agentKind,
        surfaceOnlyItems(agentKind),
        Date.now()
      ),
    };
  }
  return { complete: false, items: surfaceOnlyItems(agentKind) };
}

function rememberItems(
  projectRootPath: string,
  agentKind: string,
  items: ComposerSkillSuggestItem[],
  now: number
): ComposerSkillSuggestItem[] {
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

  // No workspace path — pure surface catalog; safe to cache (no disk to retry).
  if (!projectRootPath) {
    return rememberItems(
      projectRootPath,
      agentKind,
      surfaceOnlyItems(agentKind),
      now
    );
  }

  const projectRef = await resolveProjectRef(projectRootPath);
  if (!projectRef) {
    // Warm-up / empty projects list: still surface commands+bundled, but do
    // **not** TTL-cache — next open should re-resolve so disk skills appear.
    return surfaceOnlyItems(agentKind);
  }
  const raw = await window.pier.projectSkills.snapshot(projectRef);
  const snapshot = normalizeSnapshot(raw);
  if (!snapshot) {
    // Malformed snapshot: surface fallback without pinning a 30s empty-disk cache.
    return surfaceOnlyItems(agentKind);
  }

  const items = buildComposerSkillSuggestItems(snapshot, agentKind);
  return rememberItems(projectRootPath, agentKind, items, now);
}

/**
 * Debounced skill list client for the composer skill popup.
 * Mirrors composer-path-query: search() returns a cancel function.
 */
export function createComposerSkillQueryClient(): {
  dispose: () => void;
  search: (args: {
    agentKind: string;
    /**
     * Optional map before filter (e.g. localize command descriptions so
     * query matches zh-CN detail text).
     */
    mapItem?: (item: ComposerSkillSuggestItem) => ComposerSkillSuggestItem;
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
    search: ({ agentKind, mapItem, onUpdate, projectRootPath, query }) => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      const id = ++requestId;
      const seed = seedItemsForAgent(projectRootPath, agentKind);
      const preparedSeed = mapItem ? seed.items.map(mapItem) : seed.items;
      onUpdate({
        items: filterComposerSkillSuggestItems(preparedSeed, query),
        status: seed.complete ? "done" : "loading",
      });
      if (seed.complete) {
        return () => {
          requestId += 1;
        };
      }

      timer = setTimeout(() => {
        timer = null;
        loadItemsForAgent(projectRootPath, agentKind)
          .then((all) => {
            if (disposed || id !== requestId) {
              return;
            }
            const prepared = mapItem ? all.map(mapItem) : all;
            const items = filterComposerSkillSuggestItems(prepared, query);
            onUpdate({ items, status: "done" });
          })
          .catch(() => {
            if (disposed || id !== requestId) {
              return;
            }
            // Skills IPC failed — still offer static surface catalog (no disk).
            const prepared = mapItem
              ? surfaceOnlyItems(agentKind).map(mapItem)
              : surfaceOnlyItems(agentKind);
            const items = filterComposerSkillSuggestItems(prepared, query);
            onUpdate({ items, status: "done" });
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
