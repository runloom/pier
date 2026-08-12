/**
 * Preload facade for main-hosted LSP sessions.
 *
 * Renderer surface:
 *   - window.pier.lsp.ensureSession({ rootPath, filePath?, … })
 *   - window.pier.lsp.send(sessionId, message)
 *   - window.pier.lsp.close(sessionId)
 *   - window.pier.lsp.onMessage(listener)
 */
import type {
  LspPolicyPrefs,
  LspSessionClosedEvent,
  LspSessionEnsureRequest,
  LspSessionEnsureResult,
  LspSessionMessageEvent,
} from "@shared/contracts/lsp.ts";
import type {
  LspRequestCommand,
  LspRequestResult,
} from "@shared/contracts/lsp-language-tools.ts";
import type { LspCatalogStatusRow } from "@shared/contracts/lsp-provider.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { type IpcRendererEvent, ipcRenderer } from "electron";

export interface PierLspAPI {
  catalogStatus(): Promise<LspCatalogStatusRow[]>;
  close(sessionId: string): Promise<boolean>;
  ensureSession(
    request: LspSessionEnsureRequest
  ): Promise<LspSessionEnsureResult | null>;
  languageToolsRequest(request: LspRequestCommand): Promise<LspRequestResult>;
  onClosed(listener: (event: LspSessionClosedEvent) => void): () => void;
  onMessage(listener: (event: LspSessionMessageEvent) => void): () => void;
  onPolicyChanged(listener: (prefs: LspPolicyPrefs) => void): () => void;
  /**
   * Resolve a CSS @import / @source package or relative specifier for definition.
   */
  resolveCssImport(input: {
    allowDirectory?: boolean;
    fromFilePath: string;
    specifier: string;
  }): Promise<{ isDirectory: boolean; path: string } | null>;
  send(sessionId: string, message: string): Promise<boolean>;
}

const listeners = new Set<(event: LspSessionMessageEvent) => void>();
const closedListeners = new Set<(event: LspSessionClosedEvent) => void>();
const policyListeners = new Set<(prefs: LspPolicyPrefs) => void>();

ipcRenderer.on(
  PIER.LSP_POLICY_CHANGED,
  (_ipcEvent: IpcRendererEvent, prefs: LspPolicyPrefs) => {
    for (const listener of policyListeners) {
      try {
        listener(prefs);
      } catch {
        // Keep multiplexer alive.
      }
    }
  }
);

ipcRenderer.on(
  PIER.LSP_SESSION_CLOSED,
  (_ipcEvent: IpcRendererEvent, payload: LspSessionClosedEvent) => {
    for (const listener of closedListeners) {
      try {
        listener(payload);
      } catch {
        // Keep multiplexer alive.
      }
    }
  }
);

ipcRenderer.on(
  PIER.LSP_SESSION_MESSAGE,
  (_ipcEvent: IpcRendererEvent, payload: LspSessionMessageEvent) => {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Keep multiplexer alive.
      }
    }
  }
);

function isEnsureResult(value: unknown): value is LspSessionEnsureResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as {
    ok?: unknown;
    sessionId?: unknown;
    rootPath?: unknown;
  };
  if (record.ok === true) {
    return (
      typeof record.sessionId === "string" &&
      typeof record.rootPath === "string"
    );
  }
  if (record.ok === false) {
    return typeof record.rootPath === "string";
  }
  return false;
}

function isCatalogStatus(value: unknown): value is LspCatalogStatusRow[] {
  return Array.isArray(value);
}

export const lspApi: PierLspAPI = {
  catalogStatus: async () => {
    try {
      const result = await ipcRenderer.invoke(PIER.LSP_CATALOG_STATUS);
      return isCatalogStatus(result) ? result : [];
    } catch {
      return [];
    }
  },
  close: async (sessionId) => {
    try {
      return (
        (await ipcRenderer.invoke(PIER.LSP_SESSION_CLOSE, { sessionId })) ===
        true
      );
    } catch {
      return false;
    }
  },
  ensureSession: async (request) => {
    try {
      const result = await ipcRenderer.invoke(PIER.LSP_SESSION_ENSURE, request);
      return isEnsureResult(result) ? result : null;
    } catch {
      return null;
    }
  },
  languageToolsRequest: async (request) => {
    try {
      return (await ipcRenderer.invoke(
        PIER.LSP_LANGUAGE_TOOLS_REQUEST,
        request
      )) as LspRequestResult;
    } catch {
      return { ok: false, reason: "ipc-error", result: null };
    }
  },
  onClosed: (listener) => {
    closedListeners.add(listener);
    return () => {
      closedListeners.delete(listener);
    };
  },
  onPolicyChanged: (listener) => {
    policyListeners.add(listener);
    return () => {
      policyListeners.delete(listener);
    };
  },
  onMessage: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  resolveCssImport: async (input) => {
    try {
      const result = await ipcRenderer.invoke(
        PIER.LSP_RESOLVE_CSS_IMPORT,
        input
      );
      if (
        result &&
        typeof result === "object" &&
        typeof (result as { path?: unknown }).path === "string" &&
        typeof (result as { isDirectory?: unknown }).isDirectory === "boolean"
      ) {
        return result as { isDirectory: boolean; path: string };
      }
      // Backward-compat if an older main only returned { path }.
      if (
        result &&
        typeof result === "object" &&
        typeof (result as { path?: unknown }).path === "string"
      ) {
        return {
          isDirectory: false,
          path: (result as { path: string }).path,
        };
      }
      return null;
    } catch {
      return null;
    }
  },
  send: async (sessionId, message) => {
    try {
      return (
        (await ipcRenderer.invoke(PIER.LSP_SESSION_SEND, {
          message,
          sessionId,
        })) === true
      );
    } catch {
      return false;
    }
  },
};
