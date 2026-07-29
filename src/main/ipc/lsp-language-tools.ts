import { relative } from "node:path";
import type { LspSessionClosedEvent } from "@shared/contracts/lsp.ts";
import type {
  LspRequestCommand,
  LspRequestResult,
} from "@shared/contracts/lsp-language-tools.ts";
import { fileUriFromAbsolutePath } from "@shared/lsp-uri.ts";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { appCore } from "../app-core/app-core.ts";
import type { LspServerRegistry } from "../services/lsp/lsp-server-registry.ts";
import type { LspSessionHost } from "../services/lsp/lsp-session-host.ts";
import { normalizeFsRoot } from "../services/lsp/resolve-root.ts";
import {
  deriveLspWorkspaceKey,
  type WorkspaceLspPolicy,
  waitForLspTreeCleanupWithRetry,
} from "../services/lsp/workspace-lsp-policy.ts";

interface LspLanguageToolsHandlerDeps {
  readonly deliverMessage: (
    webContents: WebContents,
    sessionId: string,
    message: string
  ) => void;
  readonly deliverSessionClosed: (
    webContents: WebContents,
    workspaceKey: string,
    event: LspSessionClosedEvent,
    treeTerminal: Promise<void>
  ) => void;
  readonly hookLifecycleOnce: (webContents: WebContents) => void;
  readonly host: LspSessionHost;
  readonly policy: WorkspaceLspPolicy;
  readonly registry: LspServerRegistry;
  readonly wirePrefsOnce: () => Promise<void>;
}

export function createLspLanguageToolsRequestHandler(
  deps: LspLanguageToolsHandlerDeps
): (
  event: IpcMainInvokeEvent,
  request: LspRequestCommand
) => Promise<LspRequestResult> {
  return async (event, request) => {
    await deps.wirePrefsOnce();
    const rootPath = normalizeFsRoot(request.rootPath);
    const isWorktree = request.isWorktree === true;
    const workspaceKey = deriveLspWorkspaceKey({
      isWorktree,
      rootPath,
      ...(request.workspaceKey ? { workspaceKey: request.workspaceKey } : {}),
    });

    const provider = deps.registry.matchForPath(request.filePath);
    if (!provider) {
      return { ok: false, reason: "no-provider", result: null };
    }

    if (
      !(await waitForLspTreeCleanupWithRetry({
        host: deps.host,
        policy: deps.policy,
        workspaceKey,
      }))
    ) {
      return { ok: false, reason: "cleanup-failed", result: null };
    }

    const decision = deps.policy.acquire({
      isWorktree,
      kind: "local",
      rootPath,
      workspaceKey,
    });
    if (decision.kind === "deny") {
      return { ok: false, reason: decision.reason, result: null };
    }

    // Hold idle reaping for this workspace while a LanguageTools request runs.
    deps.policy.markAgentBusy(workspaceKey, true);
    try {
      if (decision.evictWorkspaceKey) {
        const victimSessions = [
          ...deps.policy.sessionsOf(decision.evictWorkspaceKey),
        ];
        await deps.host.closeMany(victimSessions, "workspace-evicted");
        deps.policy.markInactive(decision.evictWorkspaceKey);
      }

      const serverRoot = provider.resolveRoot({
        fallbackWorkspaceRoot: rootPath,
        filePath: request.filePath,
      });
      const launch = await provider.resolveLaunch({
        rootPath: serverRoot,
        workspaceKey,
      });
      if (!launch) {
        return { ok: false, reason: "server-unavailable", result: null };
      }
      deps.hookLifecycleOnce(event.sender);
      const ensured = deps.host.ensure({
        clientRole: "language-tools",
        launch,
        onCloseAccepted: (sessionId) => {
          deps.policy.markTreeDraining(workspaceKey, sessionId);
        },
        onClose: (closedEvent, treeTerminal) => {
          deps.deliverSessionClosed(
            event.sender,
            workspaceKey,
            closedEvent,
            treeTerminal
          );
        },
        onMessage: (sessionId, message) => {
          deps.deliverMessage(event.sender, sessionId, message);
        },
        rootPath: serverRoot,
        serverId: provider.id,
        webContentsId: event.sender.id,
        workspaceKey,
      });
      deps.policy.bindSession(workspaceKey, ensured.sessionId);
      await deps.host.ensureInitialized(ensured.sessionId, {
        capabilities: {
          textDocument: {
            definition: {},
            diagnostic: {},
            documentSymbol: {},
            hover: {},
            references: {},
          },
          workspace: { symbol: {} },
        },
        clientInfo: { name: "Pier LanguageTools" },
        processId: process.pid,
        rootUri: fileUriFromAbsolutePath(serverRoot),
        workspaceFolders: [
          {
            name: serverRoot.split(/[\\/]/).at(-1) ?? serverRoot,
            uri: fileUriFromAbsolutePath(serverRoot),
          },
        ],
      });

      const params = { ...request.params };
      if (request.method.startsWith("textDocument/")) {
        const languageId = provider.languageIdForPath(request.filePath);
        const files = appCore.services.files;
        if (!(languageId && files)) {
          throw new Error("LanguageTools document is not readable");
        }
        const uri = fileUriFromAbsolutePath(request.filePath);
        await deps.host.ensureLanguageToolsDocumentOpen(
          ensured.sessionId,
          { languageId, uri },
          async () => {
            const document = await files.readDocument({
              path: relative(rootPath, request.filePath),
              root: rootPath,
            });
            if (document.kind !== "text") {
              throw new Error("LanguageTools document is not readable");
            }
            return document.contents;
          }
        );
        params.textDocument = { uri };
      }
      const result = await deps.host.request(
        ensured.sessionId,
        request.method,
        params
      );
      return { ok: true, result: result ?? null };
    } catch (error) {
      console.error("[lsp] language-tools request failed", error);
      return { ok: false, reason: "request-failed", result: null };
    } finally {
      deps.policy.markAgentBusy(workspaceKey, false);
      deps.policy.release(workspaceKey);
    }
  };
}
