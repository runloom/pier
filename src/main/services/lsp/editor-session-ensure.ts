import type {
  LspSessionClosedEvent,
  LspSessionEnsureRequest,
  LspSessionEnsureResult,
} from "@shared/contracts/lsp.ts";
import type { WebContents } from "electron";
import {
  languageIdForEnsure,
  resolveEnsureProvider,
} from "./resolve-provider.ts";
import { normalizeFsRoot } from "./resolve-root.ts";
import type { LspServerRegistry } from "./server-registry.ts";
import type { LspSessionBroker } from "./session-broker.ts";
import type { LspSessionHost } from "./session-host.ts";
import {
  deriveLspWorkspaceKey,
  type WorkspaceLspPolicy,
  waitForLspTreeCleanupWithRetry,
} from "./workspace-policy.ts";

export async function ensureEditorLspSession(input: {
  broker: LspSessionBroker;
  deliverMessage(wc: WebContents, sessionId: string, message: string): void;
  deliverSessionClosed(wc: WebContents, event: LspSessionClosedEvent): void;
  hookLifecycleOnce(wc: WebContents): void;
  host: LspSessionHost;
  policy: WorkspaceLspPolicy;
  registry: LspServerRegistry;
  request: LspSessionEnsureRequest;
  sender: WebContents;
}): Promise<LspSessionEnsureResult> {
  const { broker, host, policy, registry, request, sender } = input;
  const rootPath = normalizeFsRoot(request.rootPath);
  const isWorktree = request.isWorktree === true;
  const workspaceKey = deriveLspWorkspaceKey({
    isWorktree,
    rootPath,
    ...(request.workspaceKey ? { workspaceKey: request.workspaceKey } : {}),
  });
  const kind = request.kind ?? "local";
  const resolved = resolveEnsureProvider(registry, request);
  if (!resolved) {
    return {
      ok: false,
      reason: "no-provider",
      rootPath,
      workspaceKey,
    };
  }

  const cleaned = await waitForLspTreeCleanupWithRetry({
    host,
    policy,
    workspaceKey,
  });
  if (!cleaned) {
    return {
      ok: false,
      reason: "cleanup-failed",
      rootPath,
      serverId: resolved.id,
      workspaceKey,
    };
  }

  const decision = policy.acquire({
    isWorktree,
    kind,
    rootPath,
    workspaceKey,
  });
  if (decision.kind === "deny") {
    return {
      ok: false,
      reason: decision.reason,
      rootPath,
      serverId: resolved.id,
      workspaceKey,
    };
  }

  let acquisitionHeld = true;
  const releaseAcquisition = () => {
    if (!acquisitionHeld) {
      return;
    }
    acquisitionHeld = false;
    policy.release(workspaceKey);
  };

  try {
    if (decision.evictWorkspaceKey) {
      const victimSessions = [...policy.sessionsOf(decision.evictWorkspaceKey)];
      await host.closeMany(victimSessions, "workspace-evicted");
      policy.markInactive(decision.evictWorkspaceKey);
    }

    const filePath = request.filePath ?? rootPath;
    const serverRoot = resolved.resolveRoot({
      fallbackWorkspaceRoot: rootPath,
      filePath,
    });
    const launch = await resolved.resolveLaunch({
      rootPath: serverRoot,
      workspaceKey,
    });
    if (!launch) {
      releaseAcquisition();
      return {
        ok: false,
        reason: "server-unavailable",
        rootPath,
        serverId: resolved.id,
        workspaceKey,
      };
    }
    input.hookLifecycleOnce(sender);
    const ensured = broker.ensureEditorSession({
      deliver: (virtualSessionId, message) => {
        input.deliverMessage(sender, virtualSessionId, message);
      },
      launch,
      notifyClosed: (_virtualSessionId, closedEvent) => {
        input.deliverSessionClosed(sender, closedEvent);
      },
      rootPath: serverRoot,
      serverId: resolved.id,
      webContentsId: sender.id,
      workspaceKey,
    });
    policy.bindSession(workspaceKey, ensured.realSessionId);
    releaseAcquisition();
    return {
      languageId: languageIdForEnsure(resolved, request),
      ok: true,
      rootPath: ensured.rootPath,
      serverId: ensured.serverId,
      sessionId: ensured.virtualSessionId,
      workspaceKey,
    };
  } catch (error) {
    console.error("[lsp] ensure failed", error);
    releaseAcquisition();
    return {
      ok: false,
      reason: "launch-failed",
      rootPath,
      serverId: resolved.id,
      workspaceKey,
    };
  }
}
