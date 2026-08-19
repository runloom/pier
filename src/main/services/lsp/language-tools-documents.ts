import { JSON_RPC_OBJECT_SCHEMA } from "./json-rpc.ts";
import type { LanguageToolsTextDocument } from "./session-runtime.ts";

interface LanguageToolsDocumentState {
  /** null = 服务器侧内容未知（观察到增量 didChange 后无法离线还原）。 */
  text: string | null;
  version: number;
}

function readTextDocumentField(value: unknown): Record<string, unknown> | null {
  const params = JSON_RPC_OBJECT_SCHEMA.safeParse(value);
  if (!params.success) {
    return null;
  }
  const textDocument = JSON_RPC_OBJECT_SCHEMA.safeParse(
    params.data.textDocument
  );
  return textDocument.success ? textDocument.data : null;
}

/**
 * 真实会话的服务器侧文档镜像（Gateway 唯一文档层的底座）：
 * 跟踪 didOpen / didChange / didClose 后服务器认知的 text/version，
 * 供 language-tools 按需同步与 document-gate 的 didOpen 归并使用。
 */
export class LspLanguageToolsDocuments {
  readonly #syncPromises = new Map<string, Promise<void>>();
  readonly #documents = new Map<string, LanguageToolsDocumentState>();
  #generation = 0;

  observeOutbound(value: Record<string, unknown>): void {
    if (
      value.method !== "textDocument/didOpen" &&
      value.method !== "textDocument/didClose" &&
      value.method !== "textDocument/didChange"
    ) {
      return;
    }
    const params = JSON_RPC_OBJECT_SCHEMA.safeParse(value.params);
    const documentValue = params.success
      ? readTextDocumentField(value.params)
      : null;
    if (typeof documentValue?.uri !== "string") {
      return;
    }
    if (value.method === "textDocument/didClose") {
      this.#documents.delete(documentValue.uri);
      return;
    }
    if (value.method === "textDocument/didChange") {
      const current = this.#documents.get(documentValue.uri);
      const version =
        typeof documentValue.version === "number"
          ? documentValue.version
          : (current?.version ?? 0) + 1;
      const changes = params.success ? params.data.contentChanges : undefined;
      let text: string | null = null;
      if (Array.isArray(changes) && changes.length === 1) {
        const only = JSON_RPC_OBJECT_SCHEMA.safeParse(changes[0]);
        // 单条无 range 的变更是全文替换，可离线还原服务器侧文本。
        if (
          only.success &&
          !Object.hasOwn(only.data, "range") &&
          typeof only.data.text === "string"
        ) {
          text = only.data.text;
        }
      }
      this.#documents.set(documentValue.uri, { text, version });
      return;
    }
    this.#documents.set(documentValue.uri, {
      text: typeof documentValue.text === "string" ? documentValue.text : "",
      version:
        typeof documentValue.version === "number" ? documentValue.version : 0,
    });
  }

  state(uri: string): { text: string | null; version: number } | null {
    const current = this.#documents.get(uri);
    return current ? { ...current } : null;
  }

  ensureOpen(
    document: LanguageToolsTextDocument,
    readText: () => Promise<string>,
    send: (jsonBody: string) => boolean,
    isAccepted: () => boolean
  ): Promise<void> {
    const generation = this.#generation;
    const previousSync =
      this.#syncPromises.get(document.uri) ?? Promise.resolve();
    const sync = previousSync
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.#generation || !isAccepted()) {
          throw new Error("LSP session closing");
        }
        const text = await readText();
        if (generation !== this.#generation || !isAccepted()) {
          throw new Error("LSP session closing");
        }
        const current = this.#documents.get(document.uri);
        if (current?.text === text) {
          return;
        }
        const version = (current?.version ?? 0) + 1;
        const message = current
          ? {
              jsonrpc: "2.0",
              method: "textDocument/didChange",
              params: {
                contentChanges: [{ text }],
                textDocument: { uri: document.uri, version },
              },
            }
          : {
              jsonrpc: "2.0",
              method: "textDocument/didOpen",
              params: {
                textDocument: {
                  languageId: document.languageId,
                  text,
                  uri: document.uri,
                  version,
                },
              },
            };
        if (!send(JSON.stringify(message))) {
          throw new Error("LSP session not available");
        }
        this.#documents.set(document.uri, { text, version });
      });
    this.#syncPromises.set(document.uri, sync);
    const clear = () => {
      if (this.#syncPromises.get(document.uri) === sync) {
        this.#syncPromises.delete(document.uri);
      }
    };
    sync.then(clear, clear);
    return sync;
  }

  beginClose(send: (jsonBody: string) => boolean): void {
    this.#generation += 1;
    for (const uri of this.#documents.keys()) {
      send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/didClose",
          params: { textDocument: { uri } },
        })
      );
    }
    this.#documents.clear();
    this.#syncPromises.clear();
  }
}
