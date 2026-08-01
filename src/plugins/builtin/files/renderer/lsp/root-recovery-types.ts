import type { LSPClient } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import type {
  LspPolicyPrefs,
  LspSessionEnsureFailure,
  LspSessionEnsureRequest,
  LspSessionEnsureSuccess,
} from "@shared/contracts/lsp.ts";
import type { FilesLanguageServiceStatus } from "../panel/language-service-status.ts";
import type { LspFacade, SessionTransport } from "./session-coordinator.ts";
import type { PierFilesWorkspace } from "./workspace-client.ts";

export const LSP_RECONNECT_DELAYS_MS = [250, 1000, 4000] as const;
export const LSP_RECONNECT_RESET_MS = 30_000;
export interface LspReconnectAttempt {
  readonly attempt: 1 | 2 | 3;
  readonly delayMs: (typeof LSP_RECONNECT_DELAYS_MS)[number];
}

export function lspReconnectAttempt(
  attempt: number
): LspReconnectAttempt | null {
  switch (attempt) {
    case 1:
      return { attempt, delayMs: LSP_RECONNECT_DELAYS_MS[0] };
    case 2:
      return { attempt, delayMs: LSP_RECONNECT_DELAYS_MS[1] };
    case 3:
      return { attempt, delayMs: LSP_RECONNECT_DELAYS_MS[2] };
    default:
      return null;
  }
}

export type RecoveryReason =
  | "exited"
  | "failed"
  | "send-failed"
  | "initialize-failed";

export interface FilesLspRootAttachment {
  readonly absolutePath: string;
  connect(client: LSPClient, languageId: string): void;
  disconnect(): void;
  readonly documentId: string;
  languageId?: string;
  readonly ownerId: string;
  publish(status: FilesLanguageServiceStatus | null): void;
}

export interface FilesLspRootLease {
  release(): void;
  resume(): void;
  setPolicy(prefs: LspPolicyPrefs): void;
}

export interface RootGeneration {
  readonly client: LSPClient;
  faulted: boolean;
  readonly generation: number;
  ready: boolean;
  readonly serverId: string;
  readonly sessionId: string;
  readonly transport: SessionTransport;
  readonly workspace: PierFilesWorkspace | null;
}

export interface RootSessionInput {
  readonly cacheKey: string;
  readonly ensured: LspSessionEnsureSuccess;
  readonly facade: LspFacade;
  readonly isWorktree: boolean;
  readonly onDelete: () => void;
  readonly onDisplayFile: (absolutePath: string) => Promise<EditorView | null>;
  readonly onSessionChanged: (sessionId: string) => void;
  readonly request: LspSessionEnsureRequest;
  readonly shouldRetainWithoutAttachments: () => boolean;
}

export function disabledFilesLspStatus(
  prefs: LspPolicyPrefs,
  isWorktree: boolean
): FilesLanguageServiceStatus | null {
  if (!prefs.enabled) {
    return { reason: "globally-disabled", state: "disabled" };
  }
  if (isWorktree && !prefs.worktreesEnabled) {
    return { reason: "worktrees-disabled", state: "disabled" };
  }
  return null;
}

export function statusForEnsureFailure(
  failure: LspSessionEnsureFailure
): FilesLanguageServiceStatus {
  if (failure.reason === "globally-disabled") {
    return { reason: "globally-disabled", state: "disabled" };
  }
  if (failure.reason === "worktrees-disabled") {
    return { reason: "worktrees-disabled", state: "disabled" };
  }
  if (failure.reason === "no-provider") {
    return { reason: "no-provider", state: "unsupported" };
  }
  if (failure.reason === "unsupported-root") {
    return { reason: "unsupported-root", state: "unsupported" };
  }
  return {
    ...(failure.serverId ? { serverId: failure.serverId } : {}),
    reason: failure.reason,
    state: "error",
  };
}
