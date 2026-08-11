/**
 * LSP session runtime public types (split from session-runtime for file-size).
 */

import type {
  LspSessionCloseCause,
  LspSessionClosedEvent,
} from "@shared/contracts/lsp.ts";
import type { JsonRpcErrorShape } from "./json-rpc.ts";
import type {
  LspChildProcess,
  ProcessTreeHandle,
} from "./process-termination.ts";

export const LSP_REQUEST_TIMEOUT_MS = 30_000;
export const LSP_SHUTDOWN_RESPONSE_TIMEOUT_MS = 2000;
export const LSP_STDERR_LOG_CHUNK_BYTES = 8 * 1024;
export const LSP_STDERR_LOG_SESSION_BYTES = 64 * 1024;

export type LspSessionPhase =
  | "running"
  | "initializing"
  | "ready"
  | "shutting-down"
  | "exit-sent"
  | "terminating"
  | "closed";

export type LspSessionClientRole = "editor" | "language-tools";

export interface LanguageToolsTextDocument {
  languageId: string;
  uri: string;
}

export interface RuntimeLogger {
  error(...values: unknown[]): void;
  warn(...values: unknown[]): void;
}

export interface LspSessionRuntimeOptions {
  child: LspChildProcess;
  clientRole: LspSessionClientRole;
  /** Merged into outbound `initialize` params (see LspServerLaunchSpec). */
  initializationOptions?: Readonly<Record<string, unknown>>;
  logger?: RuntimeLogger;
  onMessage: (sessionId: string, jsonBody: string) => void;
  onOutcome: (event: LspSessionClosedEvent) => void;
  processTree: ProcessTreeHandle;
  rootPath: string;
  serverId: string;
  sessionId: string;
  webContentsId: number;
  workspaceKey: string;
}

export class LspResponseError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcErrorShape) {
    super(error.message);
    this.name = "LspResponseError";
    this.code = error.code;
    this.data = error.data;
  }
}

export interface LspSessionRuntime {
  readonly child: LspChildProcess;
  readonly clientRole: LspSessionClientRole;
  close(cause: LspSessionCloseCause): Promise<void>;
  ensureInitialized(params: Record<string, unknown>): Promise<void>;
  ensureLanguageToolsDocumentOpen(
    document: LanguageToolsTextDocument,
    readText: () => Promise<string>
  ): Promise<void>;
  readonly phase: LspSessionPhase;
  readonly processTree: ProcessTreeHandle;
  request(method: string, params: unknown): Promise<unknown>;
  readonly requestedCloseCause: LspSessionCloseCause | null;
  retryTermination(): Promise<void>;
  readonly rootPath: string;
  send(jsonBody: string): boolean;
  readonly serverId: string;
  readonly sessionId: string;
  readonly terminal: Promise<void>;
  readonly terminationAttempt: Promise<void> | null;
  readonly webContentsId: number;
  readonly workspaceKey: string;
}
