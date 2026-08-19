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
  /** Merged into outbound `initialize` params (see LspServerLaunchSpec). */
  initializationOptions?: Readonly<Record<string, unknown>>;
  logger?: RuntimeLogger;
  /**
   * runtime 未消费的入站消息（含服务器通知 / broker wire 响应 /
   * server→client 请求）。`parsed` 是 runtime 已解析的同一消息体，
   * 供 broker 免二次 JSON.parse。
   */
  onMessage: (
    sessionId: string,
    jsonBody: string,
    parsed: Record<string, unknown>
  ) => void;
  onOutcome: (event: LspSessionClosedEvent) => void;
  processTree: ProcessTreeHandle;
  rootPath: string;
  serverId: string;
  sessionId: string;
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
  close(cause: LspSessionCloseCause): Promise<void>;
  /** 服务器侧文档镜像（document-gate 的 didOpen 归并读取用）。 */
  documentState(uri: string): { text: string | null; version: number } | null;
  /** initialize 幂等：首次发起并缓存结果，后续消费者复用同一结果。 */
  ensureInitialized(params: Record<string, unknown>): Promise<unknown>;
  ensureLanguageToolsDocumentOpen(
    document: LanguageToolsTextDocument,
    readText: () => Promise<string>
  ): Promise<void>;
  /** initialize 成功后的服务器结果缓存（未初始化时为 undefined）。 */
  readonly initializeResult: unknown;
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
  readonly workspaceKey: string;
}
