import { JSON_RPC_OBJECT_SCHEMA } from "./json-rpc.ts";
import type { LanguageToolsTextDocument } from "./session-runtime.ts";

interface LanguageToolsDocumentState {
  text: string;
  version: number;
}

export class LspLanguageToolsDocuments {
  readonly #syncPromises = new Map<string, Promise<void>>();
  readonly #documents = new Map<string, LanguageToolsDocumentState>();
  #generation = 0;

  observeOutbound(value: Record<string, unknown>): void {
    if (
      value.method !== "textDocument/didOpen" &&
      value.method !== "textDocument/didClose"
    ) {
      return;
    }
    const params = JSON_RPC_OBJECT_SCHEMA.safeParse(value.params);
    const textDocument = params.success
      ? JSON_RPC_OBJECT_SCHEMA.safeParse(params.data.textDocument)
      : null;
    const documentValue = textDocument?.success ? textDocument.data : null;
    if (typeof documentValue?.uri !== "string") {
      return;
    }
    if (value.method === "textDocument/didClose") {
      this.#documents.delete(documentValue.uri);
      return;
    }
    this.#documents.set(documentValue.uri, {
      text: typeof documentValue.text === "string" ? documentValue.text : "",
      version:
        typeof documentValue.version === "number" ? documentValue.version : 0,
    });
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
