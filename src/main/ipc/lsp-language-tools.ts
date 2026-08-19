import { relative } from "node:path";
import type {
  LspRequestCommand,
  LspRequestResult,
} from "@shared/contracts/lsp-language-tools.ts";
import { fileUriFromAbsolutePath } from "@shared/lsp-uri.ts";
import type { IpcMainInvokeEvent } from "electron";
import { appCore } from "../app-core/index.ts";
import { normalizeFsRoot } from "../services/lsp/resolve-root.ts";
import type { LspServerRegistry } from "../services/lsp/server-registry.ts";
import type { LspSessionBroker } from "../services/lsp/session-broker.ts";
import type { LspSessionHost } from "../services/lsp/session-host.ts";
import {
  deriveLspWorkspaceKey,
  type WorkspaceLspPolicy,
  waitForLspTreeCleanupWithRetry,
} from "../services/lsp/workspace-policy.ts";

interface LspLanguageToolsHandlerDeps {
  readonly broker: LspSessionBroker;
  readonly host: LspSessionHost;
  readonly policy: WorkspaceLspPolicy;
  readonly registry: LspServerRegistry;
  readonly wirePrefsOnce: () => Promise<void>;
}

/**
 * Language-tools 是 Gateway 上的 main 侧消费者：与 editor 消费者共享同一
 * 真实进程树（无独立会话）。initialize 参数由 broker 统一提供（超集
 * capabilities），文档打开经 broker 的 document-gate（编辑器持有的文档
 * 不用磁盘内容覆盖）。
 */
export function createLspLanguageToolsRequestHandler(
  deps: LspLanguageToolsHandlerDeps
): (
  event: IpcMainInvokeEvent,
  request: LspRequestCommand
) => Promise<LspRequestResult> {
  return async (_event, request) => {
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
    let realSessionId: string | undefined;
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
      const ensured = deps.broker.ensureRealSession({
        launch,
        rootPath: serverRoot,
        serverId: provider.id,
        workspaceKey,
      });
      realSessionId = ensured.realSessionId;
      deps.broker.retainLanguageTools(ensured.realSessionId);
      deps.policy.bindSession(workspaceKey, ensured.realSessionId);
      await deps.broker.ensureInitialized(ensured.realSessionId);

      const params = { ...request.params };
      if (request.method.startsWith("textDocument/")) {
        const languageId = provider.languageIdForPath(request.filePath);
        const files = appCore.services.files;
        if (!(languageId && files)) {
          throw new Error("LanguageTools document is not readable");
        }
        const uri = fileUriFromAbsolutePath(request.filePath);
        await deps.broker.ensureLanguageToolsDocumentOpen(
          ensured.realSessionId,
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
        ensured.realSessionId,
        request.method,
        params
      );
      return { ok: true, result: result ?? null };
    } catch (error) {
      console.error("[lsp] language-tools request failed", error);
      return { ok: false, reason: "request-failed", result: null };
    } finally {
      if (realSessionId) {
        deps.broker.releaseLanguageTools(realSessionId);
      }
      deps.policy.markAgentBusy(workspaceKey, false);
      deps.policy.release(workspaceKey);
    }
  };
}
