import { JSON_RPC_OBJECT_SCHEMA } from "./json-rpc.ts";

const DID_OPEN = "textDocument/didOpen";
const DID_CLOSE = "textDocument/didClose";

/** language-tools 短命引用的存活窗口：请求后保温，避免 hover 流反复重开。 */
export const LSP_EPHEMERAL_DOCUMENT_TTL_MS = 60_000;
/** language-tools 短命引用的 LRU 上限：防止长会话扫文件累积服务器侧打开文档。 */
export const LSP_MAX_EPHEMERAL_DOCUMENTS = 32;

export interface LspDocumentGateDeps {
  /** 服务器侧文档镜像（真实会话 runtime 的 documents 状态）。 */
  documentState(uri: string): { text: string | null; version: number } | null;
  ephemeralTtlMs?: number;
  maxEphemeralDocuments?: number;
  now?(): number;
  send(jsonBody: string): boolean;
}

export interface LspDocumentGateOutcome {
  /** true = gate 已消化（转发/改写/吞掉），broker 不再原样转发。 */
  handled: boolean;
  sent: boolean;
}

const NOT_HANDLED: LspDocumentGateOutcome = { handled: false, sent: false };

function documentUriOf(params: unknown): string | null {
  const parsed = JSON_RPC_OBJECT_SCHEMA.safeParse(params);
  if (!parsed.success) {
    return null;
  }
  const textDocument = JSON_RPC_OBJECT_SCHEMA.safeParse(
    parsed.data.textDocument
  );
  if (!textDocument.success || typeof textDocument.data.uri !== "string") {
    return null;
  }
  return textDocument.data.uri;
}

function didOpenTextOf(params: unknown): string | null {
  const parsed = JSON_RPC_OBJECT_SCHEMA.safeParse(params);
  if (!parsed.success) {
    return null;
  }
  const textDocument = JSON_RPC_OBJECT_SCHEMA.safeParse(
    parsed.data.textDocument
  );
  if (!textDocument.success || typeof textDocument.data.text !== "string") {
    return null;
  }
  return textDocument.data.text;
}

/**
 * Gateway 唯一文档层：didOpen / didClose 按消费者引用计数。
 *
 * - 首个引用转发 didOpen；后续消费者的 didOpen 归并为全文 didChange
 *   （文本一致则直接吞掉，仅记引用）。
 * - didClose 只有在最后一个编辑器引用且无 language-tools 短命引用时才
 *   下发服务器，否则吞掉。
 * - didChange 不在 gate 管辖（最后写入者胜，服务器镜像由 runtime 观察）。
 */
export class LspDocumentGate {
  readonly #deps: LspDocumentGateDeps;
  readonly #editorRefsByUri = new Map<string, Set<string>>();
  /** Map 保持插入序 = LRU 序；值为过期时间戳。 */
  readonly #ephemeralExpiryByUri = new Map<string, number>();
  readonly #ephemeralTtlMs: number;
  readonly #maxEphemeralDocuments: number;
  readonly #now: () => number;
  #sweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: LspDocumentGateDeps) {
    this.#deps = deps;
    this.#ephemeralTtlMs = deps.ephemeralTtlMs ?? LSP_EPHEMERAL_DOCUMENT_TTL_MS;
    this.#maxEphemeralDocuments =
      deps.maxEphemeralDocuments ?? LSP_MAX_EPHEMERAL_DOCUMENTS;
    this.#now = deps.now ?? Date.now;
  }

  handleEditorDocumentMessage(
    consumerId: string,
    parsed: Record<string, unknown>,
    jsonBody: string
  ): LspDocumentGateOutcome {
    if (parsed.method === DID_OPEN) {
      return this.#handleDidOpen(consumerId, parsed, jsonBody);
    }
    if (parsed.method === DID_CLOSE) {
      return this.#handleDidClose(consumerId, parsed, jsonBody);
    }
    return NOT_HANDLED;
  }

  hasEditorRefs(uri: string): boolean {
    return (this.#editorRefsByUri.get(uri)?.size ?? 0) > 0;
  }

  /** 记（或续期）一个 language-tools 短命引用；超 LRU 上限立即收编最旧者。 */
  holdEphemeral(uri: string): void {
    this.#ephemeralExpiryByUri.delete(uri);
    this.#ephemeralExpiryByUri.set(uri, this.#now() + this.#ephemeralTtlMs);
    while (this.#ephemeralExpiryByUri.size > this.#maxEphemeralDocuments) {
      const oldest = this.#ephemeralExpiryByUri.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#dropEphemeral(oldest);
    }
    this.#scheduleSweep();
  }

  releaseEphemeral(uri: string): boolean {
    if (!this.#ephemeralExpiryByUri.has(uri)) {
      return false;
    }
    this.#dropEphemeral(uri);
    return true;
  }

  ephemeralUris(): readonly string[] {
    return [...this.#ephemeralExpiryByUri.keys()];
  }

  releaseConsumer(consumerId: string): void {
    for (const [uri, refs] of this.#editorRefsByUri) {
      if (!refs.delete(consumerId)) {
        continue;
      }
      if (refs.size === 0) {
        this.#editorRefsByUri.delete(uri);
        if (!this.#ephemeralExpiryByUri.has(uri)) {
          this.#sendDidClose(uri);
        }
      }
    }
  }

  clear(): void {
    this.#editorRefsByUri.clear();
    this.#ephemeralExpiryByUri.clear();
    if (this.#sweepTimer) {
      clearTimeout(this.#sweepTimer);
      this.#sweepTimer = null;
    }
  }

  /** 释放短命引用：无编辑器引用时向服务器 didClose。 */
  #dropEphemeral(uri: string): void {
    this.#ephemeralExpiryByUri.delete(uri);
    if (!this.hasEditorRefs(uri)) {
      this.#sendDidClose(uri);
    }
  }

  #scheduleSweep(): void {
    if (this.#sweepTimer || this.#ephemeralExpiryByUri.size === 0) {
      return;
    }
    const earliest = Math.min(...this.#ephemeralExpiryByUri.values());
    const delay = Math.max(0, earliest - this.#now());
    this.#sweepTimer = setTimeout(() => {
      this.#sweepTimer = null;
      this.#sweepExpired();
    }, delay);
    this.#sweepTimer.unref?.();
  }

  #sweepExpired(): void {
    const now = this.#now();
    for (const [uri, expiresAt] of this.#ephemeralExpiryByUri) {
      if (expiresAt <= now) {
        this.#dropEphemeral(uri);
      }
    }
    this.#scheduleSweep();
  }

  #handleDidOpen(
    consumerId: string,
    parsed: Record<string, unknown>,
    jsonBody: string
  ): LspDocumentGateOutcome {
    const uri = documentUriOf(parsed.params);
    if (!uri) {
      return NOT_HANDLED;
    }
    const refs = this.#editorRefsByUri.get(uri) ?? new Set<string>();
    const isFirstRef = refs.size === 0 && !this.#ephemeralExpiryByUri.has(uri);
    refs.add(consumerId);
    this.#editorRefsByUri.set(uri, refs);

    const state = this.#deps.documentState(uri);
    if (isFirstRef && !state) {
      return { handled: true, sent: this.#deps.send(jsonBody) };
    }
    const text = didOpenTextOf(parsed.params);
    if (text !== null && state?.text === text) {
      // 服务器已持有同样内容：只记引用，不重复打开。
      return { handled: true, sent: true };
    }
    if (text === null) {
      // 结构异常的 didOpen：服务器已有该文档时吞掉，避免 double-open。
      return { handled: true, sent: true };
    }
    const version = (state?.version ?? 0) + 1;
    const converted = JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        contentChanges: [{ text }],
        textDocument: { uri, version },
      },
    });
    return { handled: true, sent: this.#deps.send(converted) };
  }

  #handleDidClose(
    consumerId: string,
    parsed: Record<string, unknown>,
    jsonBody: string
  ): LspDocumentGateOutcome {
    const uri = documentUriOf(parsed.params);
    if (!uri) {
      return NOT_HANDLED;
    }
    const refs = this.#editorRefsByUri.get(uri);
    refs?.delete(consumerId);
    if (refs && refs.size === 0) {
      this.#editorRefsByUri.delete(uri);
    }
    if (this.hasEditorRefs(uri) || this.#ephemeralExpiryByUri.has(uri)) {
      return { handled: true, sent: true };
    }
    return { handled: true, sent: this.#deps.send(jsonBody) };
  }

  #sendDidClose(uri: string): boolean {
    return this.#deps.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: DID_CLOSE,
        params: { textDocument: { uri } },
      })
    );
  }
}
