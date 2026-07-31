/**
 * Single source of truth for file-tree folder expansion intents.
 * Model expand/collapse is a projection; refresh/reset must re-apply this.
 */

export type ExpansionSource = "user" | "api" | "reveal" | "seed" | "restore";

export interface TreeExpansionIntent {
  readonly collapsed: ReadonlySet<string>;
  readonly expanded: ReadonlySet<string>;
}

export interface TreeExpansionPersistedV1 {
  readonly collapsed: readonly string[];
  readonly expanded: readonly string[];
  readonly updatedAt: number;
  readonly v: 1;
}

const TRAILING_SLASHES_PATTERN = /\/+$/;

export function normalizeExpansionPath(path: string): string {
  if (path.length === 0) {
    return "";
  }
  return path.endsWith("/") ? path.replace(TRAILING_SLASHES_PATTERN, "") : path;
}

export function emptyExpansionIntent(): TreeExpansionIntent {
  return {
    collapsed: new Set(),
    expanded: new Set(),
  };
}

function cloneIntent(intent: TreeExpansionIntent): TreeExpansionIntent {
  return {
    collapsed: new Set(intent.collapsed),
    expanded: new Set(intent.expanded),
  };
}

function intentsEqual(
  left: TreeExpansionIntent,
  right: TreeExpansionIntent
): boolean {
  if (
    left.expanded.size !== right.expanded.size ||
    left.collapsed.size !== right.collapsed.size
  ) {
    return false;
  }
  for (const path of left.expanded) {
    if (!right.expanded.has(path)) {
      return false;
    }
  }
  for (const path of left.collapsed) {
    if (!right.collapsed.has(path)) {
      return false;
    }
  }
  return true;
}

export interface TreeExpansionAuthority {
  collapseAll(
    knownDirectoryPaths: Iterable<string>,
    source?: ExpansionSource
  ): void;
  expandPaths(paths: readonly string[], source: ExpansionSource): void;
  getIntent(): TreeExpansionIntent;
  loadJSON(data: unknown, source?: "restore"): boolean;
  pruneToKnown(knownDirectoryPaths: ReadonlySet<string>): void;
  /**
   * Drop intents only for directories that disappeared from the known set
   * (were present before, absent now). Paths never previously known stay
   * (lazy-load / cold restore of nested expansion).
   */
  reconcileKnownDirectories(
    previousKnown: ReadonlySet<string>,
    nextKnown: ReadonlySet<string>
  ): void;
  remapPath(from: string, to: string): void;
  replaceIntent(next: TreeExpansionIntent, source: ExpansionSource): void;
  readonly scopeId: string;
  setDirectoryExpanded(
    path: string,
    expanded: boolean,
    source: ExpansionSource
  ): void;
  subscribe(listener: () => void): () => void;
  toJSON(): TreeExpansionPersistedV1;
}

class TreeExpansionAuthorityImpl implements TreeExpansionAuthority {
  readonly scopeId: string;
  #intent: TreeExpansionIntent = emptyExpansionIntent();
  readonly #listeners = new Set<() => void>();

  constructor(scopeId: string) {
    this.scopeId = scopeId;
  }

  getIntent(): TreeExpansionIntent {
    return cloneIntent(this.#intent);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  setDirectoryExpanded(
    path: string,
    expanded: boolean,
    _source: ExpansionSource
  ): void {
    const normalized = normalizeExpansionPath(path);
    if (normalized.length === 0) {
      return;
    }
    const nextExpanded = new Set(this.#intent.expanded);
    const nextCollapsed = new Set(this.#intent.collapsed);
    if (expanded) {
      nextExpanded.add(normalized);
      nextCollapsed.delete(normalized);
    } else {
      nextCollapsed.add(normalized);
      nextExpanded.delete(normalized);
    }
    this.#commit({ collapsed: nextCollapsed, expanded: nextExpanded });
  }

  replaceIntent(next: TreeExpansionIntent, _source: ExpansionSource): void {
    const collapsed = new Set(
      [...next.collapsed].map(normalizeExpansionPath).filter(Boolean)
    );
    const expanded = new Set(
      [...next.expanded].map(normalizeExpansionPath).filter(Boolean)
    );
    // collapsed wins on intersection
    for (const path of collapsed) {
      expanded.delete(path);
    }
    this.#commit({ collapsed, expanded });
  }

  collapseAll(
    knownDirectoryPaths: Iterable<string>,
    source: ExpansionSource = "api"
  ): void {
    const collapsed = new Set<string>();
    for (const path of knownDirectoryPaths) {
      const normalized = normalizeExpansionPath(path);
      if (normalized.length > 0) {
        collapsed.add(normalized);
      }
    }
    this.replaceIntent({ collapsed, expanded: new Set() }, source);
  }

  expandPaths(paths: readonly string[], source: ExpansionSource): void {
    const nextExpanded = new Set(this.#intent.expanded);
    const nextCollapsed = new Set(this.#intent.collapsed);
    for (const path of paths) {
      const normalized = normalizeExpansionPath(path);
      if (normalized.length === 0) {
        continue;
      }
      nextExpanded.add(normalized);
      nextCollapsed.delete(normalized);
    }
    this.replaceIntent(
      { collapsed: nextCollapsed, expanded: nextExpanded },
      source
    );
  }

  remapPath(from: string, to: string): void {
    const fromNorm = normalizeExpansionPath(from);
    const toNorm = normalizeExpansionPath(to);
    if (fromNorm.length === 0 || fromNorm === toNorm) {
      return;
    }
    const remapKey = (path: string): string | null => {
      if (path === fromNorm) {
        return toNorm.length > 0 ? toNorm : null;
      }
      if (path.startsWith(`${fromNorm}/`)) {
        if (toNorm.length === 0) {
          return null;
        }
        return `${toNorm}${path.slice(fromNorm.length)}`;
      }
      return path;
    };
    const nextExpanded = new Set<string>();
    const nextCollapsed = new Set<string>();
    for (const path of this.#intent.expanded) {
      const mapped = remapKey(path);
      if (mapped) {
        nextExpanded.add(mapped);
      }
    }
    for (const path of this.#intent.collapsed) {
      const mapped = remapKey(path);
      if (mapped) {
        nextCollapsed.add(mapped);
      }
    }
    for (const path of nextCollapsed) {
      nextExpanded.delete(path);
    }
    this.#commit({ collapsed: nextCollapsed, expanded: nextExpanded });
  }

  pruneToKnown(knownDirectoryPaths: ReadonlySet<string>): void {
    const known = new Set(
      [...knownDirectoryPaths].map(normalizeExpansionPath).filter(Boolean)
    );
    const nextExpanded = new Set<string>();
    const nextCollapsed = new Set<string>();
    for (const path of this.#intent.expanded) {
      if (known.has(path)) {
        nextExpanded.add(path);
      }
    }
    for (const path of this.#intent.collapsed) {
      if (known.has(path)) {
        nextCollapsed.add(path);
      }
    }
    this.#commit({ collapsed: nextCollapsed, expanded: nextExpanded });
  }

  reconcileKnownDirectories(
    previousKnown: ReadonlySet<string>,
    nextKnown: ReadonlySet<string>
  ): void {
    const previous = new Set(
      [...previousKnown].map(normalizeExpansionPath).filter(Boolean)
    );
    const next = new Set(
      [...nextKnown].map(normalizeExpansionPath).filter(Boolean)
    );
    if (previous.size === 0) {
      return;
    }
    const nextExpanded = new Set(this.#intent.expanded);
    const nextCollapsed = new Set(this.#intent.collapsed);
    let changed = false;
    for (const path of previous) {
      if (next.has(path)) {
        continue;
      }
      if (nextExpanded.delete(path) || nextCollapsed.delete(path)) {
        changed = true;
      }
    }
    if (changed) {
      this.#commit({ collapsed: nextCollapsed, expanded: nextExpanded });
    }
  }

  toJSON(): TreeExpansionPersistedV1 {
    return {
      collapsed: [...this.#intent.collapsed].sort(),
      expanded: [...this.#intent.expanded].sort(),
      updatedAt: Date.now(),
      v: 1,
    };
  }

  loadJSON(data: unknown, source: "restore" = "restore"): boolean {
    if (data == null || typeof data !== "object") {
      return false;
    }
    const record = data as Record<string, unknown>;
    if (record.v !== 1) {
      return false;
    }
    const expandedRaw = record.expanded;
    const collapsedRaw = record.collapsed;
    if (!(Array.isArray(expandedRaw) && Array.isArray(collapsedRaw))) {
      return false;
    }
    const expanded = new Set<string>();
    const collapsed = new Set<string>();
    for (const value of expandedRaw) {
      if (typeof value === "string") {
        const path = normalizeExpansionPath(value);
        if (path.length > 0) {
          expanded.add(path);
        }
      }
    }
    for (const value of collapsedRaw) {
      if (typeof value === "string") {
        const path = normalizeExpansionPath(value);
        if (path.length > 0) {
          collapsed.add(path);
        }
      }
    }
    for (const path of collapsed) {
      expanded.delete(path);
    }
    this.replaceIntent({ collapsed, expanded }, source);
    return true;
  }

  #commit(next: TreeExpansionIntent): void {
    if (intentsEqual(this.#intent, next)) {
      return;
    }
    this.#intent = {
      collapsed: new Set(next.collapsed),
      expanded: new Set(next.expanded),
    };
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

const authoritiesByScope = new Map<string, TreeExpansionAuthorityImpl>();

export function getTreeExpansionAuthority(
  scopeId: string
): TreeExpansionAuthority {
  const existing = authoritiesByScope.get(scopeId);
  if (existing) {
    return existing;
  }
  const created = new TreeExpansionAuthorityImpl(scopeId);
  authoritiesByScope.set(scopeId, created);
  return created;
}

/** Test / hot-reload helper. */
export function resetTreeExpansionAuthoritiesForTests(): void {
  authoritiesByScope.clear();
}

export function filesTreeExpansionScopeId(projectRoot: string): string {
  return `files:${projectRoot}`;
}

export function gitReviewTreeExpansionScopeId(
  contextId: string,
  targetKey: string
): string {
  return `git-review:${contextId}:${targetKey}`;
}
