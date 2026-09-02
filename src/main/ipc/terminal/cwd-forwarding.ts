import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import {
  releaseGitIdentityDiscovery,
  resetGitIdentityDiscoveryForTests,
  retainGitIdentityDiscovery,
  syncGitIdentityDiscovery,
} from "../../services/git/identity-discovery.ts";
import { panelGitIdentityDigest } from "../../services/panel-context-identity.ts";
import { resolvePanelContextForPath } from "../../services/panel-context-resolver.ts";
import { recordRecentPanelContext } from "../../state/panel-context-state.ts";
import {
  peekTerminalPanelContext,
  updateTerminalPanelContext,
} from "../../state/terminal-session-state.ts";
import type { AppWindow } from "../../windows/app-window.ts";
import { forwardToWindow } from "./forwarding.ts";
import { windowRecordIdFor } from "./window-scope.ts";

interface CwdForwardScope {
  alive: boolean;
  browserWindowId: number;
  cwd: string;
  emittedDigest: string | undefined;
  generation: number;
  gitRoot: string | undefined;
  needsEmitDigest: string | undefined;
  panelId: string;
  pendingInvalidation: boolean;
  targetWindow: AppWindow | null;
}

const scopes = new Map<string, CwdForwardScope>();

function cwdForwardScopeKey(
  sessionScope: string | null,
  browserWindowId: number,
  panelId: string
): string {
  return `${sessionScope ?? `bw:${browserWindowId}`}::${panelId}`;
}

function gitRootOf(
  context: { gitRoot?: string | undefined } | null | undefined
): string | undefined {
  const root = context?.gitRoot;
  return root && root.length > 0 ? root : undefined;
}

function forgetScope(scopeKey: string): void {
  const scope = scopes.get(scopeKey);
  if (scope) {
    scope.alive = false;
    scope.emittedDigest = undefined;
    scope.generation += 1;
    scope.needsEmitDigest = undefined;
    scope.pendingInvalidation = false;
  }
  releaseGitIdentityDiscovery(scopeKey);
}

function refreshScope(scopeKey: string): Promise<void> {
  const scope = scopes.get(scopeKey);
  if (!scope?.alive) {
    return Promise.resolve();
  }
  scope.pendingInvalidation = true;
  return handleTerminalCwdChange(
    scope.browserWindowId,
    scope.panelId,
    scope.cwd,
    scope.targetWindow
  ).catch((err: unknown) => {
    console.error("[pier-cwd-identity] failed:", err);
  });
}

function wireDiscovery(scopeKey: string, scope: CwdForwardScope): void {
  syncGitIdentityDiscovery(scopeKey, {
    cwd: scope.cwd,
    gitRoot: scope.gitRoot,
    onDirty: () => {
      const current = scopes.get(scopeKey);
      if (current?.alive) {
        current.pendingInvalidation = true;
      }
    },
    onInvalidate: () => refreshScope(scopeKey),
  });
}

function touchScope(
  scopeKey: string,
  browserWindowId: number,
  panelId: string,
  cwd: string,
  targetWindow: AppWindow | null
): CwdForwardScope {
  const existing = scopes.get(scopeKey);
  if (existing) {
    existing.alive = true;
    existing.browserWindowId = browserWindowId;
    existing.cwd = cwd;
    existing.panelId = panelId;
    existing.targetWindow = targetWindow;
    return existing;
  }
  const created: CwdForwardScope = {
    alive: true,
    browserWindowId,
    cwd,
    emittedDigest: undefined,
    generation: 0,
    gitRoot: undefined,
    needsEmitDigest: undefined,
    panelId,
    pendingInvalidation: false,
    targetWindow,
  };
  scopes.set(scopeKey, created);
  return created;
}

export function resetTerminalCwdForwardingForTests(): void {
  scopes.clear();
  resetGitIdentityDiscoveryForTests();
}

export function releaseTerminalCwdForwarding(
  sessionScope: string | null,
  browserWindowId: number,
  panelId: string
): void {
  forgetScope(cwdForwardScopeKey(sessionScope, browserWindowId, panelId));
  if (sessionScope) {
    forgetScope(`bw:${browserWindowId}::${panelId}`);
  }
}

export function retainTerminalCwdForwarding(
  sessionScope: string,
  activePanelIds: readonly string[]
): void {
  const prefix = `${sessionScope}::`;
  const keep = new Set(
    activePanelIds.map((panelId) => `${sessionScope}::${panelId}`)
  );
  for (const scopeKey of [...scopes.keys()]) {
    if (scopeKey.startsWith(prefix) && !keep.has(scopeKey)) {
      forgetScope(scopeKey);
    }
  }
  retainGitIdentityDiscovery(sessionScope, activePanelIds);
}

/**
 * OSC 7 often repeats the same cwd on every prompt. Re-resolving and
 * broadcasting would flash the terminal status bar.
 *
 * Same-cwd skips after this session has emitted an identity, unless git-identity
 * discovery marks the scope dirty. Identity itself only comes from
 * `resolvePanelContextForPath`.
 */
export async function handleTerminalCwdChange(
  id: number,
  rawPanelId: string,
  cwd: string,
  targetWindow: AppWindow | null
): Promise<void> {
  const sessionScope =
    targetWindow && !targetWindow.isDestroyed()
      ? windowRecordIdFor(targetWindow)
      : null;
  const scopeKey = cwdForwardScopeKey(sessionScope, id, rawPanelId);
  const previousContext = sessionScope
    ? peekTerminalPanelContext(sessionScope, rawPanelId)
    : undefined;
  const existing = scopes.get(scopeKey);
  const previousCwd = existing?.cwd;
  const scope = touchScope(scopeKey, id, rawPanelId, cwd, targetWindow);
  if (previousCwd !== undefined && previousCwd !== cwd) {
    scope.gitRoot = undefined;
  } else if (scope.gitRoot === undefined) {
    scope.gitRoot = gitRootOf(previousContext);
  }
  wireDiscovery(scopeKey, scope);

  const sameCwd = previousCwd === cwd;
  const settledThisSession = scope.emittedDigest !== undefined;
  if (sameCwd && settledThisSession && !scope.pendingInvalidation) {
    return;
  }
  scope.pendingInvalidation = false;

  const generation = scope.generation + 1;
  scope.generation = generation;
  const context = await resolvePanelContextForPath(cwd, {
    source: "panel",
  });
  if (!scope.alive || scope.generation !== generation) {
    return;
  }

  const digest = panelGitIdentityDigest(context);
  const nextGitRoot = gitRootOf(context);
  scope.gitRoot = nextGitRoot;
  wireDiscovery(scopeKey, scope);
  if (scope.emittedDigest === digest) {
    scope.needsEmitDigest = undefined;
    return;
  }
  const peekDigest = panelGitIdentityDigest(previousContext);
  if (
    scope.emittedDigest === undefined &&
    scope.needsEmitDigest !== digest &&
    previousContext &&
    peekDigest === digest
  ) {
    scope.emittedDigest = digest;
    return;
  }

  try {
    await recordRecentPanelContext(context);
    if (!scope.alive || scope.generation !== generation) {
      return;
    }
    if (targetWindow && !targetWindow.isDestroyed() && sessionScope) {
      await updateTerminalPanelContext(sessionScope, rawPanelId, context);
      if (!scope.alive || scope.generation !== generation) {
        return;
      }
    }
    forwardToWindow(
      id,
      PIER_BROADCAST.TERMINAL_CWD_CHANGED,
      { panelId: rawPanelId, context },
      "pier-cwd-forward"
    );
  } catch (err) {
    if (scope.alive && scope.generation === generation) {
      scope.needsEmitDigest = digest;
      scope.pendingInvalidation = true;
    }
    throw err;
  }
  if (!scope.alive || scope.generation !== generation) {
    return;
  }
  scope.needsEmitDigest = undefined;
  scope.emittedDigest = digest;
}
