import type { LSPClient } from "@codemirror/lsp-client";
import type { FilesLspParams, FilesLspRequestResult } from "./hover-types.ts";

export class FilesLspHoverRequests {
  readonly #pending = new Set<{
    client: LSPClient;
    params: FilesLspParams;
  }>();

  async request(
    client: LSPClient,
    method: string,
    params: FilesLspParams
  ): Promise<FilesLspRequestResult> {
    const pending = { client, params };
    this.#pending.add(pending);
    try {
      return { ok: true, value: await client.request(method, params) };
    } catch {
      return { ok: false };
    } finally {
      this.#pending.delete(pending);
    }
  }

  cancel(): void {
    for (const pending of this.#pending) {
      pending.client.cancelRequest(pending.params);
    }
    this.#pending.clear();
  }
}
