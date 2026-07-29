import type {
  LspDenyReason,
  LspPolicyPrefs,
  LspWorkspaceKind,
} from "@shared/contracts/lsp.ts";
import { normalizeFsRoot } from "./resolve-root.ts";
import { LSP_TREE_CLEANUP_WAIT_MS } from "./workspace-lsp-tree-cleanup.ts";

export interface LspWorkspaceRuntimeState {
  active: boolean;
  agentBusy: boolean;
  isWorktree: boolean;
  kind: LspWorkspaceKind;
  lastTouchAt: number;
  refCount: number;
  rootPath: string;
  sessionIds: string[];
  workspaceKey: string;
}

export type LspEnsureDecision =
  | {
      evictWorkspaceKey?: string;
      kind: "allow";
      rootPath: string;
      workspaceKey: string;
    }
  | {
      kind: "deny";
      reason: LspDenyReason;
      rootPath: string;
      workspaceKey: string;
    };

const DEFAULT_PREFS: LspPolicyPrefs = {
  enabled: true,
  idleReleaseMs: 1_800_000,
  maxLocalWorkspaces: 3,
  maxRemoteWorkspaces: 2,
  worktreesEnabled: false,
};

export function defaultLspPolicyPrefs(): LspPolicyPrefs {
  return { ...DEFAULT_PREFS };
}

export class WorkspaceLspPolicy {
  readonly #byKey = new Map<string, LspWorkspaceRuntimeState>();
  readonly #listeners = new Set<() => void>();
  readonly #treeWorkspaceBySession = new Map<string, string>();
  readonly #treeCleanupFailed = new Set<string>();
  readonly #treeCleanupWaiters = new Map<
    string,
    Set<(cleaned: boolean) => void>
  >();
  readonly #onIdleWorkspaces: (workspaceKeys: string[]) => void;
  readonly #now: () => number;
  #prefs: LspPolicyPrefs;
  #idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(input?: {
    idleTickMs?: number;
    now?: () => number;
    onIdleWorkspaces?: (workspaceKeys: string[]) => void;
    prefs?: Partial<LspPolicyPrefs>;
    startIdleTimer?: boolean;
  }) {
    this.#prefs = { ...DEFAULT_PREFS, ...input?.prefs };
    this.#now = input?.now ?? Date.now;
    this.#onIdleWorkspaces = input?.onIdleWorkspaces ?? (() => undefined);
    if (input?.startIdleTimer !== false) {
      const tick = input?.idleTickMs ?? 60_000;
      this.#idleTimer = setInterval(() => {
        this.#reapIdle();
      }, tick);
      this.#idleTimer.unref?.();
    }
  }

  getPrefs(): LspPolicyPrefs {
    return { ...this.#prefs };
  }

  setPrefs(patch: Partial<LspPolicyPrefs>): LspPolicyPrefs {
    this.#prefs = { ...this.#prefs, ...patch };
    this.#emit();
    return this.getPrefs();
  }

  evaluate(input: {
    isWorktree: boolean;
    kind: LspWorkspaceKind;
    rootPath: string;
    workspaceKey: string;
  }): LspEnsureDecision {
    return this.#decide(input, { acquire: false });
  }

  acquire(input: {
    isWorktree: boolean;
    kind: LspWorkspaceKind;
    rootPath: string;
    workspaceKey: string;
  }): LspEnsureDecision {
    const decision = this.#decide(input, { acquire: true });
    if (decision.kind === "allow") {
      const state = this.#ensureState(input);
      state.active = true;
      state.refCount += 1;
      state.lastTouchAt = this.#now();
      this.#emit();
    }
    return decision;
  }

  release(workspaceKey: string, sessionId?: string): void {
    const state = this.#byKey.get(workspaceKey);
    if (!state) {
      return;
    }
    state.refCount = Math.max(0, state.refCount - 1);
    if (sessionId) {
      state.sessionIds = state.sessionIds.filter((id) => id !== sessionId);
    }
    if (
      state.refCount === 0 &&
      state.sessionIds.length === 0 &&
      !this.hasTreeBlocker(workspaceKey)
    ) {
      state.active = false;
    }
    state.lastTouchAt = this.#now();
    this.#emit();
  }

  bindSession(workspaceKey: string, sessionId: string): void {
    const state = this.#byKey.get(workspaceKey);
    if (!state) {
      return;
    }
    if (!state.sessionIds.includes(sessionId)) {
      state.sessionIds = [...state.sessionIds, sessionId];
    }
    state.active = true;
    state.lastTouchAt = this.#now();
    this.#emit();
  }

  unbindSession(sessionId: string): string | null {
    for (const state of this.#byKey.values()) {
      if (!state.sessionIds.includes(sessionId)) {
        continue;
      }
      state.sessionIds = state.sessionIds.filter((id) => id !== sessionId);
      if (
        state.sessionIds.length === 0 &&
        state.refCount === 0 &&
        !this.hasTreeBlocker(state.workspaceKey)
      ) {
        state.active = false;
      }
      this.#emit();
      return state.workspaceKey;
    }
    return null;
  }

  markTreeDraining(workspaceKey: string, sessionId: string): void {
    if (this.#byKey.has(workspaceKey)) {
      if (!this.hasTreeBlocker(workspaceKey)) {
        this.#treeCleanupFailed.delete(workspaceKey);
      }
      this.#treeWorkspaceBySession.set(sessionId, workspaceKey);
      this.#emit();
    }
  }

  markTreeTerminal(sessionId: string): void {
    const workspaceKey = this.#treeWorkspaceBySession.get(sessionId);
    if (!workspaceKey) {
      return;
    }
    this.#treeWorkspaceBySession.delete(sessionId);
    const state = this.#byKey.get(workspaceKey);
    if (
      state &&
      state.refCount === 0 &&
      state.sessionIds.length === 0 &&
      !this.hasTreeBlocker(workspaceKey)
    ) {
      state.active = false;
    }
    if (!this.hasTreeBlocker(workspaceKey)) {
      this.#treeCleanupFailed.delete(workspaceKey);
      this.#settleTreeCleanupWaiters(workspaceKey, true);
    }
    this.#emit();
  }

  markTreeCleanupFailed(sessionId: string): void {
    const workspaceKey = this.#treeWorkspaceBySession.get(sessionId);
    if (!workspaceKey) {
      return;
    }
    this.#treeCleanupFailed.add(workspaceKey);
    this.#settleTreeCleanupWaiters(workspaceKey, false);
    this.#emit();
  }

  waitForTreeCleanup(
    workspaceKey: string,
    timeoutMs: number = LSP_TREE_CLEANUP_WAIT_MS
  ): Promise<boolean> {
    if (!this.hasTreeBlocker(workspaceKey)) {
      return Promise.resolve(true);
    }
    if (this.#treeCleanupFailed.has(workspaceKey)) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (cleaned: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const waiters = this.#treeCleanupWaiters.get(workspaceKey);
        if (waiters) {
          waiters.delete(finish);
          if (waiters.size === 0) {
            this.#treeCleanupWaiters.delete(workspaceKey);
          }
        }
        resolve(cleaned);
      };
      const timer = setTimeout(
        () => {
          // Fail this waiter without clearing blockers so retryTermination can
          // still finish; mark failed so subsequent ensures fail-fast until
          // markTreeTerminal / markTreeCleanupFailed settles the tree.
          this.#treeCleanupFailed.add(workspaceKey);
          finish(false);
        },
        Math.max(0, timeoutMs)
      );
      timer.unref?.();

      const waiters = this.#treeCleanupWaiters.get(workspaceKey);
      if (waiters) {
        waiters.add(finish);
      } else {
        this.#treeCleanupWaiters.set(workspaceKey, new Set([finish]));
      }
    });
  }

  treeBlockersOf(workspaceKey: string): readonly string[] {
    return [...this.#treeWorkspaceBySession]
      .filter(([, key]) => key === workspaceKey)
      .map(([sessionId]) => sessionId);
  }

  #settleTreeCleanupWaiters(workspaceKey: string, cleaned: boolean): void {
    const waiters = this.#treeCleanupWaiters.get(workspaceKey);
    if (!waiters) {
      return;
    }
    this.#treeCleanupWaiters.delete(workspaceKey);
    for (const resolve of waiters) {
      resolve(cleaned);
    }
  }

  hasTreeBlocker(workspaceKey: string): boolean {
    for (const blockedWorkspace of this.#treeWorkspaceBySession.values()) {
      if (blockedWorkspace === workspaceKey) {
        return true;
      }
    }
    return false;
  }

  touch(workspaceKey: string): void {
    const state = this.#byKey.get(workspaceKey);
    if (!state) {
      return;
    }
    state.lastTouchAt = this.#now();
  }

  markAgentBusy(workspaceKey: string, busy: boolean): void {
    const state = this.#byKey.get(workspaceKey);
    if (!state) {
      return;
    }
    state.agentBusy = busy;
    if (busy) {
      state.lastTouchAt = this.#now();
    }
    this.#emit();
  }

  listActive(): readonly LspWorkspaceRuntimeState[] {
    return [...this.#byKey.values()].filter((state) => state.active);
  }

  getState(workspaceKey: string): LspWorkspaceRuntimeState | null {
    return this.#byKey.get(workspaceKey) ?? null;
  }

  sessionsOf(workspaceKey: string): readonly string[] {
    return this.#byKey.get(workspaceKey)?.sessionIds ?? [];
  }

  /**
   * Idle reap candidates. Caller closes host sessions then markInactive.
   */
  reapIdleWorkspaceKeys(now = this.#now()): string[] {
    const idleMs = this.#prefs.idleReleaseMs;
    const victims: string[] = [];
    for (const state of this.#byKey.values()) {
      if (!state.active) {
        continue;
      }
      if (state.refCount > 0) {
        continue;
      }
      if (state.agentBusy) {
        continue;
      }
      if (now - state.lastTouchAt < idleMs) {
        continue;
      }
      victims.push(state.workspaceKey);
    }
    return victims;
  }

  markInactive(workspaceKey: string): void {
    const state = this.#byKey.get(workspaceKey);
    if (!state || this.hasTreeBlocker(workspaceKey)) {
      return;
    }
    state.active = false;
    state.sessionIds = [];
    state.refCount = 0;
    this.#emit();
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.#idleTimer) {
      clearInterval(this.#idleTimer);
      this.#idleTimer = null;
    }
    this.#byKey.clear();
    this.#treeWorkspaceBySession.clear();
    this.#listeners.clear();
    for (const workspaceKey of this.#treeCleanupWaiters.keys()) {
      this.#settleTreeCleanupWaiters(workspaceKey, false);
    }
    this.#treeCleanupFailed.clear();
  }

  #reapIdle(): void {
    const keys = this.reapIdleWorkspaceKeys();
    if (keys.length === 0) {
      return;
    }
    // Host close is the caller's job (onIdleWorkspaces); keep session ids until then.
    this.#onIdleWorkspaces(keys);
  }

  #decide(
    input: {
      isWorktree: boolean;
      kind: LspWorkspaceKind;
      rootPath: string;
      workspaceKey: string;
    },
    _options: { acquire: boolean }
  ): LspEnsureDecision {
    const rootPath = normalizeFsRoot(input.rootPath);
    const { workspaceKey } = input;

    if (!this.#prefs.enabled) {
      return {
        kind: "deny",
        reason: "globally-disabled",
        rootPath,
        workspaceKey,
      };
    }
    if (input.isWorktree && !this.#prefs.worktreesEnabled) {
      return {
        kind: "deny",
        reason: "worktrees-disabled",
        rootPath,
        workspaceKey,
      };
    }
    if (this.hasTreeBlocker(workspaceKey)) {
      return { kind: "deny", reason: "limit-reached", rootPath, workspaceKey };
    }

    const limit =
      input.kind === "remote"
        ? this.#prefs.maxRemoteWorkspaces
        : this.#prefs.maxLocalWorkspaces;

    const activeSameKind = [...this.#byKey.values()].filter(
      (entry) => entry.active && entry.kind === input.kind
    );
    const already = activeSameKind.find(
      (entry) => entry.workspaceKey === workspaceKey
    );
    if (already || activeSameKind.length < limit) {
      return { kind: "allow", rootPath, workspaceKey };
    }

    const victim = this.#pickLruEvictable(activeSameKind, workspaceKey);
    if (!victim) {
      return { kind: "deny", reason: "limit-reached", rootPath, workspaceKey };
    }
    return {
      kind: "allow",
      rootPath,
      workspaceKey,
      evictWorkspaceKey: victim.workspaceKey,
    };
  }

  #pickLruEvictable(
    activeSameKind: LspWorkspaceRuntimeState[],
    excludeKey: string
  ): LspWorkspaceRuntimeState | null {
    const candidates = activeSameKind
      .filter(
        (entry) =>
          entry.workspaceKey !== excludeKey &&
          entry.refCount === 0 &&
          !entry.agentBusy &&
          !this.hasTreeBlocker(entry.workspaceKey)
      )
      .sort((a, b) => a.lastTouchAt - b.lastTouchAt);
    return candidates[0] ?? null;
  }

  #ensureState(input: {
    isWorktree: boolean;
    kind: LspWorkspaceKind;
    rootPath: string;
    workspaceKey: string;
  }): LspWorkspaceRuntimeState {
    const existing = this.#byKey.get(input.workspaceKey);
    if (existing) {
      existing.rootPath = normalizeFsRoot(input.rootPath);
      existing.isWorktree = input.isWorktree;
      existing.kind = input.kind;
      return existing;
    }
    const created: LspWorkspaceRuntimeState = {
      active: false,
      agentBusy: false,
      isWorktree: input.isWorktree,
      kind: input.kind,
      lastTouchAt: this.#now(),
      refCount: 0,
      rootPath: normalizeFsRoot(input.rootPath),
      sessionIds: [],
      workspaceKey: input.workspaceKey,
    };
    this.#byKey.set(input.workspaceKey, created);
    return created;
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }
}

export { deriveLspWorkspaceKey } from "./workspace-lsp-key.ts";
export {
  LSP_TREE_CLEANUP_RETRY_WAIT_MS,
  LSP_TREE_CLEANUP_WAIT_MS,
  waitForLspTreeCleanupWithRetry,
} from "./workspace-lsp-tree-cleanup.ts";
