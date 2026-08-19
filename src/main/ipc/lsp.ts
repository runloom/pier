/**
 * LSP session IPC — Policy + Registry + Gateway(Broker) + Host orchestration.
 * Renderer speaks bare JSON-RPC strings (Transport for @codemirror/lsp-client)
 * against virtual sessions; real process trees are deduped by the broker on
 * (workspaceKey, serverId, rootPath).
 */

import {
  type LspSessionClosedEvent,
  type LspSessionCloseRequest,
  type LspSessionEnsureRequest,
  type LspSessionEnsureResult,
  type LspSessionMessageEvent,
  type LspSessionSendRequest,
  lspSessionCloseRequestSchema,
  lspSessionEnsureRequestSchema,
  lspSessionSendRequestSchema,
} from "@shared/contracts/lsp.ts";
import {
  type LspRequestResult,
  lspRequestCommandSchema,
} from "@shared/contracts/lsp-language-tools.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/index.ts";
import { createBootstrappedLspRegistry } from "../services/lsp/bootstrap-providers.ts";
import {
  createLspE2eObserverFromEnvironment,
  installLspE2eObserverGlobal,
  removeLspE2eObserverGlobal,
} from "../services/lsp/e2e-observer.ts";
import { ensureEditorLspSession } from "../services/lsp/editor-session-ensure.ts";
import {
  bindLspHostBridge,
  unbindLspHostBridge,
} from "../services/lsp/host-bridge.ts";
import { createLspMemoryBudgetMonitor } from "../services/lsp/memory-budget.ts";
import { applyLspPrefsToPolicy } from "../services/lsp/prefs-wiring.ts";
import { LspSessionBroker } from "../services/lsp/session-broker.ts";
import { LspSessionHost } from "../services/lsp/session-host.ts";
import {
  type LspWorkspaceRuntimeState,
  WorkspaceLspPolicy,
} from "../services/lsp/workspace-policy.ts";
import { listProcessTable } from "../services/pier-resource/process-table.ts";
import { windowManager } from "../windows/manager.ts";
import { registerLspCatalogIpc } from "./lsp-catalog.ts";
import { createLspLanguageToolsRequestHandler } from "./lsp-language-tools.ts";
import { isTrustedMainFrame } from "./trusted-main-frame.ts";

const lspE2eObserver = createLspE2eObserverFromEnvironment({
  closeSession: (sessionId, cause) => host.close(sessionId, cause),
});
const host = new LspSessionHost({
  ...(lspE2eObserver ? { observer: lspE2eObserver } : {}),
});
if (lspE2eObserver) {
  installLspE2eObserverGlobal(lspE2eObserver);
}
const registry = createBootstrappedLspRegistry();
bindLspHostBridge({ host, registry });
async function closeWorkspaceSessions(
  workspaceKey: string,
  cause: "idle-release" | "policy-disabled"
): Promise<void> {
  const sessionIds = [...policy.sessionsOf(workspaceKey)];
  await host.closeMany(sessionIds, cause);
  policy.markInactive(workspaceKey);
}

const policy = new WorkspaceLspPolicy({
  onIdleWorkspaces: (workspaceKeys) => {
    for (const workspaceKey of workspaceKeys) {
      closeWorkspaceSessions(workspaceKey, "idle-release").catch(
        (error: unknown) => {
          console.error("[lsp] idle session cleanup failed", {
            error,
            workspaceKey,
          });
        }
      );
    }
  },
  startIdleTimer: true,
});
const memoryBudget = createLspMemoryBudgetMonitor({
  closeWorkspaceSessions: (workspaceKey, cause) =>
    closeWorkspaceSessions(
      workspaceKey,
      cause === "policy-disabled" ? "policy-disabled" : "idle-release"
    ),
  listProcessTable,
  listSessions: () => host.listSessions(),
  logger: console,
  policy: {
    getPrefs: () => policy.getPrefs(),
    hasTreeBlocker: (workspaceKey) => policy.hasTreeBlocker(workspaceKey),
    listActive: () => policy.listActive(),
  },
});
memoryBudget.start();
const broker = new LspSessionBroker({
  host,
  logger: console,
  onRealSessionCloseAccepted: (info) => {
    policy.markTreeDraining(info.workspaceKey, info.realSessionId);
  },
  onRealSessionClosed: (info, event, treeTerminal) => {
    policy.markTreeDraining(info.workspaceKey, event.sessionId);
    treeTerminal.then(
      () => {
        policy.release(info.workspaceKey, event.sessionId);
        policy.markTreeTerminal(event.sessionId);
      },
      (error: unknown) => {
        policy.markTreeCleanupFailed(event.sessionId);
        console.error("[lsp] process tree cleanup failed", {
          error,
          sessionId: event.sessionId,
          workspaceKey: info.workspaceKey,
        });
      }
    );
  },
});
const hookedWebContents = new WeakSet<WebContents>();
let prefsWiringPromise: Promise<void> | null = null;

function closePolicyWorkspaces(
  shouldClose: (state: LspWorkspaceRuntimeState) => boolean
): void {
  for (const state of policy.listActive()) {
    if (!shouldClose(state)) {
      continue;
    }
    host
      .closeMany(state.sessionIds, "policy-disabled")
      .then(() => {
        policy.markInactive(state.workspaceKey);
      })
      .catch((error: unknown) => {
        console.error("[lsp] policy session cleanup failed", {
          error,
          workspaceKey: state.workspaceKey,
        });
      });
  }
}

async function wirePrefs(): Promise<void> {
  try {
    const prefs = await appCore.services.preferences.read();
    applyLspPrefsToPolicy(policy, prefs.lsp);
    appCore.eventBus.subscribe((event) => {
      if (event.type !== "preferences.changed") {
        return;
      }
      if (event.changedKeys.includes("lsp")) {
        const previous = policy.getPrefs();
        applyLspPrefsToPolicy(policy, event.snapshot.lsp);
        if (previous.enabled && !event.snapshot.lsp.enabled) {
          closePolicyWorkspaces(() => true);
        } else if (
          previous.worktreesEnabled &&
          !event.snapshot.lsp.worktreesEnabled
        ) {
          closePolicyWorkspaces((state) => state.isWorktree);
        }
        for (const window of windowManager.getAll()) {
          if (!window.isDestroyed()) {
            window.webContents.send(
              PIER.LSP_POLICY_CHANGED,
              event.snapshot.lsp
            );
          }
        }
      }
    });
  } catch (err) {
    prefsWiringPromise = null;
    console.warn("[lsp] wire preferences failed:", err);
  }
}

function wirePrefsOnce(): Promise<void> {
  prefsWiringPromise ??= wirePrefs();
  return prefsWiringPromise;
}

function ensureClientHasFileRead(wc: WebContents): boolean {
  const window = windowManager.fromWebContents(wc);
  if (!window) {
    return false;
  }
  const windowId = windowManager.findInternalIdByWindow(window);
  if (!windowId) {
    return false;
  }
  const clientId = `desktop-renderer:${windowId}`;
  let client = appCore.clients.heartbeat(clientId);
  if (!client) {
    const now = Date.now();
    appCore.clients.register({
      capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"],
      createdAt: now,
      id: clientId,
      kind: "desktop-renderer",
      lastSeenAt: now,
    });
    client = appCore.clients.heartbeat(clientId);
  }
  return client?.capabilities.includes("file:read") === true;
}

function hookLifecycleOnce(wc: WebContents): void {
  if (hookedWebContents.has(wc)) {
    return;
  }
  hookedWebContents.add(wc);
  const drop = () => {
    broker.dropConsumersForWebContents(wc.id).catch((error: unknown) => {
      console.error("[lsp] owner session cleanup failed", {
        error,
        webContentsId: wc.id,
      });
    });
  };
  // Destroyed: window/tab gone. render-process-gone: renderer crash.
  // did-navigate: main-frame document navigations only (reload, recovery page,
  // leave shell). In-app SPA route changes do not fire this event.
  wc.once("destroyed", drop);
  wc.on("render-process-gone", drop);
  wc.on("did-navigate", drop);
}

function deliverMessage(
  wc: WebContents,
  sessionId: string,
  message: string
): void {
  if (wc.isDestroyed()) {
    return;
  }
  const event: LspSessionMessageEvent = { message, sessionId };
  wc.send(PIER.LSP_SESSION_MESSAGE, event);
}

function deliverSessionClosed(
  wc: WebContents,
  event: LspSessionClosedEvent
): void {
  if (!wc.isDestroyed()) {
    wc.send(PIER.LSP_SESSION_CLOSED, event);
  }
}

const handleLanguageToolsRequest = createLspLanguageToolsRequestHandler({
  broker,
  host,
  policy,
  registry,
  wirePrefsOnce,
});

async function handleEnsure(
  event: IpcMainInvokeEvent,
  request: LspSessionEnsureRequest
): Promise<LspSessionEnsureResult> {
  await wirePrefsOnce();
  return ensureEditorLspSession({
    broker,
    deliverMessage,
    deliverSessionClosed,
    hookLifecycleOnce,
    host,
    policy,
    registry,
    request,
    sender: event.sender,
  });
}

export function registerLspIpc(): void {
  ipcMain.handle(
    PIER.LSP_SESSION_ENSURE,
    async (
      event: IpcMainInvokeEvent,
      payload: unknown
    ): Promise<LspSessionEnsureResult | null> => {
      if (
        !(isTrustedMainFrame(event) && ensureClientHasFileRead(event.sender))
      ) {
        return null;
      }
      const parsed = lspSessionEnsureRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return null;
      }
      return handleEnsure(event, parsed.data);
    }
  );

  ipcMain.handle(
    PIER.LSP_SESSION_SEND,
    (event: IpcMainInvokeEvent, payload: unknown): boolean => {
      if (
        !(isTrustedMainFrame(event) && ensureClientHasFileRead(event.sender))
      ) {
        return false;
      }
      const parsed = lspSessionSendRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return false;
      }
      const request: LspSessionSendRequest = parsed.data;
      const ok = broker.handleEditorSend(
        request.sessionId,
        request.message,
        event.sender.id
      );
      if (ok) {
        const workspaceKey = broker.workspaceKeyOf(request.sessionId);
        if (workspaceKey) {
          policy.touch(workspaceKey);
        }
      }
      return ok;
    }
  );

  ipcMain.handle(
    PIER.LSP_SESSION_CLOSE,
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<boolean> => {
      if (
        !(isTrustedMainFrame(event) && ensureClientHasFileRead(event.sender))
      ) {
        return false;
      }
      const parsed = lspSessionCloseRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return false;
      }
      const request: LspSessionCloseRequest = parsed.data;
      return broker.releaseEditorSession(request.sessionId, event.sender.id);
    }
  );

  ipcMain.handle(
    PIER.LSP_LANGUAGE_TOOLS_REQUEST,
    async (
      event: IpcMainInvokeEvent,
      payload: unknown
    ): Promise<LspRequestResult> => {
      if (
        !(isTrustedMainFrame(event) && ensureClientHasFileRead(event.sender))
      ) {
        return { ok: false, reason: "unauthorized", result: null };
      }
      const parsed = lspRequestCommandSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, reason: "invalid-request", result: null };
      }
      return handleLanguageToolsRequest(event, parsed.data);
    }
  );

  registerLspCatalogIpc({
    ensureClientHasFileRead,
    registry,
  });
}

/** Test / shutdown seam */
export async function disposeLspIpcHost(): Promise<void> {
  try {
    await host.dispose();
    await lspE2eObserver?.writeFinalReport();
  } finally {
    memoryBudget.dispose();
    policy.dispose();
    unbindLspHostBridge();
    removeLspE2eObserverGlobal(lspE2eObserver);
  }
}

/** Test seam */
export function getLspIpcTestHandles() {
  return { broker, host, memoryBudget, policy, registry };
}
