import {
  LSP_MAX_MESSAGE_BYTES,
  type LspSessionCloseCause,
  type LspSessionClosedEvent,
} from "@shared/contracts/lsp.ts";
import {
  cancellableDelay as delay,
  isValidJsonRpcMessage,
  JSON_RPC_OBJECT_SCHEMA,
  type JsonRpcErrorShape,
  parseErrorShape,
} from "./json-rpc.ts";
import { LspLanguageToolsDocuments } from "./language-tools-documents.ts";
import {
  encodeLspMessage,
  LspFramingError,
  LspMessageReader,
} from "./message-codec.ts";
import type {
  LspChildProcess,
  ProcessTreeHandle,
} from "./process-termination.ts";
import { LspSessionTerminationController } from "./session-termination-controller.ts";
import { LspStderrLogger } from "./stderr-logger.ts";

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

interface PendingLspRequest {
  reject: (reason: Error) => void;
  resolve: (result: unknown) => void;
  timeout: NodeJS.Timeout;
}

export interface RuntimeLogger {
  error(...values: unknown[]): void;
  warn(...values: unknown[]): void;
}

export interface LspSessionRuntimeOptions {
  child: LspChildProcess;
  clientRole: LspSessionClientRole;
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

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
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

export function createLspSessionRuntime(
  options: LspSessionRuntimeOptions
): LspSessionRuntime {
  const logger = options.logger ?? console;
  const reader = new LspMessageReader();
  const stderrLogger = new LspStderrLogger({
    chunkBytes: LSP_STDERR_LOG_CHUNK_BYTES,
    logger,
    serverId: options.serverId,
    sessionBytes: LSP_STDERR_LOG_SESSION_BYTES,
    sessionId: options.sessionId,
  });
  const pendingRequests = new Map<number, PendingLspRequest>();
  const documents = new LspLanguageToolsDocuments();
  let phase: LspSessionPhase = "running";
  let initializationPromise: Promise<void> | null = null;
  let nextRequestId = -1;
  let shutdownResponse: Deferred<void> | null = null;

  const isWritable = () =>
    phase !== "terminating" &&
    phase !== "closed" &&
    options.child.stdin.writable;

  const isDocumentSyncAccepted = () =>
    phase !== "shutting-down" &&
    phase !== "exit-sent" &&
    phase !== "terminating" &&
    phase !== "closed";

  const rejectPendingRequests = (message: string) => {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    pendingRequests.clear();
  };
  const termination = new LspSessionTerminationController({
    child: options.child,
    logger,
    onOutcome: options.onOutcome,
    processTree: options.processTree,
    rejectPendingRequests,
    sessionId: options.sessionId,
    setPhase: (nextPhase) => {
      phase = nextPhase;
    },
  });

  const writeJsonRpcValue = (value: Record<string, unknown>): boolean => {
    if (!isWritable()) {
      return false;
    }
    const body = JSON.stringify(value);
    try {
      options.child.stdin.write(encodeLspMessage(body));
      return true;
    } catch (error) {
      logger.error("[lsp] failed to write to session", {
        error,
        sessionId: options.sessionId,
      });
      termination.beginAbnormal("failed");
      return false;
    }
  };

  const dispatchInbound = (body: string) => {
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      writeJsonRpcValue({
        error: { code: -32_700, message: "Parse error" },
        id: null,
        jsonrpc: "2.0",
      });
      return;
    }

    if (!isValidJsonRpcMessage(message)) {
      const objectCandidate = JSON_RPC_OBJECT_SCHEMA.safeParse(message);
      const responseLike =
        objectCandidate.success &&
        (Object.hasOwn(objectCandidate.data, "result") ||
          Object.hasOwn(objectCandidate.data, "error"));
      if (responseLike) {
        logger.warn(
          "[lsp] dropped invalid JSON-RPC response",
          options.sessionId
        );
        return;
      }
      writeJsonRpcValue({
        error: { code: -32_600, message: "Invalid Request" },
        id: null,
        jsonrpc: "2.0",
      });
      return;
    }

    if (!Object.hasOwn(message, "method")) {
      if (
        message.id === `pier:shutdown:${options.sessionId}` &&
        shutdownResponse
      ) {
        const pendingShutdown = shutdownResponse;
        shutdownResponse = null;
        const error = parseErrorShape(message.error);
        if (error) {
          pendingShutdown.reject(new LspResponseError(error));
        } else {
          pendingShutdown.resolve();
        }
        return;
      }
      if (typeof message.id === "number") {
        const pending = pendingRequests.get(message.id);
        if (pending) {
          pendingRequests.delete(message.id);
          clearTimeout(pending.timeout);
          const error = parseErrorShape(message.error);
          if (error) {
            pending.reject(new LspResponseError(error));
          } else {
            pending.resolve(message.result ?? null);
          }
          return;
        }
      }
    }
    options.onMessage(options.sessionId, body);
  };

  const handleStreamError = (
    stream: "stdin" | "stdout" | "stderr",
    error: unknown
  ) => {
    logger.error("[lsp] session stream error", {
      error,
      sessionId: options.sessionId,
      stream,
    });
    termination.beginAbnormal("failed");
  };

  options.child.stdin.on("error", (error) => {
    handleStreamError("stdin", error);
  });
  options.child.stdout.on("error", (error) => {
    handleStreamError("stdout", error);
  });
  options.child.stderr.on("error", (error) => {
    handleStreamError("stderr", error);
  });

  options.child.stdout.on("data", (chunk: Buffer) => {
    if (phase === "terminating" || phase === "closed") {
      return;
    }
    try {
      for (const body of reader.push(chunk)) {
        dispatchInbound(body);
      }
    } catch (error) {
      if (error instanceof LspFramingError) {
        logger.error("[lsp] framing fatal", {
          code: error.code,
          sessionId: options.sessionId,
        });
      } else {
        logger.error("[lsp] framing fatal", {
          code: "unknown-framing-error",
          sessionId: options.sessionId,
        });
      }
      termination.beginAbnormal("failed");
    }
  });

  options.child.stderr.on("data", (chunk: Buffer) => {
    stderrLogger.write(chunk);
  });

  options.child.once("exit", termination.settleChildTerminal);
  options.child.once("close", termination.settleChildTerminal);
  options.child.once("exit", () => {
    termination.handleChildExit();
  });
  options.child.once("error", (error) => {
    logger.error("[lsp] session process error", {
      error,
      serverId: options.serverId,
      sessionId: options.sessionId,
    });
    termination.beginAbnormal("failed");
  });

  const send = (jsonBody: string): boolean => {
    if (
      !isWritable() ||
      Buffer.byteLength(jsonBody, "utf8") > LSP_MAX_MESSAGE_BYTES
    ) {
      return false;
    }
    let value: unknown;
    try {
      value = JSON.parse(jsonBody);
    } catch {
      return false;
    }
    if (!isValidJsonRpcMessage(value)) {
      return false;
    }
    try {
      options.child.stdin.write(encodeLspMessage(jsonBody));
      if (value.method === "initialized") {
        phase = "ready";
      }
      documents.observeOutbound(value);
      return true;
    } catch (error) {
      logger.error("[lsp] failed to write to session", {
        error,
        sessionId: options.sessionId,
      });
      termination.beginAbnormal("failed");
      return false;
    }
  };

  const request = (method: string, params: unknown): Promise<unknown> => {
    if (!isWritable()) {
      return Promise.reject(new Error("LSP session not available"));
    }
    const id = nextRequestId;
    nextRequestId -= 1;
    const deferred = Promise.withResolvers<unknown>();
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      deferred.reject(new Error("LSP request timed out"));
    }, LSP_REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    pendingRequests.set(id, {
      reject: deferred.reject,
      resolve: deferred.resolve,
      timeout,
    });
    if (
      !send(JSON.stringify({ id, jsonrpc: "2.0", method, params })) &&
      pendingRequests.delete(id)
    ) {
      clearTimeout(timeout);
      deferred.reject(new Error("LSP session not available"));
    }
    return deferred.promise;
  };

  const ensureInitialized = (
    params: Record<string, unknown>
  ): Promise<void> => {
    if (phase === "ready") {
      return Promise.resolve();
    }
    if (initializationPromise) {
      return initializationPromise;
    }
    if (phase !== "running") {
      return Promise.reject(new Error("LSP session not available"));
    }
    phase = "initializing";
    initializationPromise = (async () => {
      await request("initialize", params);
      if (
        !send(
          JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })
        )
      ) {
        throw new Error("LSP session not available");
      }
      phase = "ready";
    })()
      .catch((error: unknown) => {
        termination.beginAbnormal("failed");
        throw error;
      })
      .finally(() => {
        initializationPromise = null;
      });
    return initializationPromise;
  };

  const ensureLanguageToolsDocumentOpen = (
    document: LanguageToolsTextDocument,
    readText: () => Promise<string>
  ): Promise<void> => {
    if (
      options.clientRole !== "language-tools" ||
      !isWritable() ||
      !isDocumentSyncAccepted()
    ) {
      return Promise.reject(new Error("LSP session not available"));
    }
    return documents.ensureOpen(
      document,
      readText,
      send,
      isDocumentSyncAccepted
    );
  };

  const close = (cause: LspSessionCloseCause): Promise<void> => {
    if (termination.closePromise) {
      return termination.closePromise;
    }
    const readyAtClose = phase === "ready";
    phase = "shutting-down";
    rejectPendingRequests("LSP session closing");
    return termination.beginClose(cause, async () => {
      documents.beginClose(send);

      if (readyAtClose && isWritable()) {
        shutdownResponse = Promise.withResolvers<void>();
        const shutdownId = `pier:shutdown:${options.sessionId}`;
        const sent = send(
          JSON.stringify({
            id: shutdownId,
            jsonrpc: "2.0",
            method: "shutdown",
          })
        );
        if (sent) {
          const timeout = delay(LSP_SHUTDOWN_RESPONSE_TIMEOUT_MS);
          try {
            await Promise.race([
              shutdownResponse.promise,
              timeout.promise.then(() => {
                throw new Error("LSP shutdown timed out");
              }),
            ]);
            timeout.cancel();
            if (send(JSON.stringify({ jsonrpc: "2.0", method: "exit" }))) {
              phase = "exit-sent";
            }
          } catch {
            timeout.cancel();
          } finally {
            shutdownResponse = null;
          }
        }
      }
      await termination.terminateTree("exited");
    });
  };

  return {
    child: options.child,
    clientRole: options.clientRole,
    close,
    ensureInitialized,
    ensureLanguageToolsDocumentOpen,
    get phase() {
      return phase;
    },
    processTree: options.processTree,
    request,
    retryTermination: termination.retryTermination,
    get requestedCloseCause() {
      return termination.requestedCloseCause;
    },
    rootPath: options.rootPath,
    send,
    serverId: options.serverId,
    sessionId: options.sessionId,
    terminal: termination.terminal,
    get terminationAttempt() {
      return termination.terminationAttempt;
    },
    webContentsId: options.webContentsId,
    workspaceKey: options.workspaceKey,
  };
}
