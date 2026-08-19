import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LSP_EPHEMERAL_DOCUMENT_TTL_MS,
  LSP_MAX_EPHEMERAL_DOCUMENTS,
  LspDocumentGate,
} from "../../../../src/main/services/lsp/document-gate.ts";

function createGate(options?: {
  ephemeralTtlMs?: number;
  maxEphemeralDocuments?: number;
}) {
  const sent: Record<string, unknown>[] = [];
  const documentStates = new Map<
    string,
    { text: string | null; version: number }
  >();
  const gate = new LspDocumentGate({
    documentState: (uri) => documentStates.get(uri) ?? null,
    send: (jsonBody) => {
      sent.push(JSON.parse(jsonBody) as Record<string, unknown>);
      return true;
    },
    ...(options?.ephemeralTtlMs === undefined
      ? {}
      : { ephemeralTtlMs: options.ephemeralTtlMs }),
    ...(options?.maxEphemeralDocuments === undefined
      ? {}
      : { maxEphemeralDocuments: options.maxEphemeralDocuments }),
  });
  const didOpen = (consumerId: string, uri: string, text: string) =>
    gate.handleEditorDocumentMessage(
      consumerId,
      {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: { languageId: "typescript", text, uri, version: 1 },
        },
      },
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: { languageId: "typescript", text, uri, version: 1 },
        },
      })
    );
  const didClose = (consumerId: string, uri: string) =>
    gate.handleEditorDocumentMessage(
      consumerId,
      {
        jsonrpc: "2.0",
        method: "textDocument/didClose",
        params: { textDocument: { uri } },
      },
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/didClose",
        params: { textDocument: { uri } },
      })
    );
  const closesFor = (uri: string) =>
    sent.filter(
      (message) =>
        message.method === "textDocument/didClose" &&
        (message.params as { textDocument: { uri: string } }).textDocument
          .uri === uri
    );
  return { closesFor, didClose, didOpen, documentStates, gate, sent };
}

describe("LspDocumentGate ephemeral refs (language-tools)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes an expired ephemeral document after the TTL and keeps refreshed ones", () => {
    vi.useFakeTimers();
    const { closesFor, gate } = createGate();
    gate.holdEphemeral("file:///repo/a.ts");
    gate.holdEphemeral("file:///repo/b.ts");

    vi.advanceTimersByTime(LSP_EPHEMERAL_DOCUMENT_TTL_MS - 1000);
    // b 续期，a 到期。
    gate.holdEphemeral("file:///repo/b.ts");
    vi.advanceTimersByTime(1000);

    expect(closesFor("file:///repo/a.ts")).toHaveLength(1);
    expect(closesFor("file:///repo/b.ts")).toHaveLength(0);
    expect(gate.ephemeralUris()).toEqual(["file:///repo/b.ts"]);

    vi.advanceTimersByTime(LSP_EPHEMERAL_DOCUMENT_TTL_MS);
    expect(closesFor("file:///repo/b.ts")).toHaveLength(1);
    expect(gate.ephemeralUris()).toEqual([]);
  });

  it("evicts the least recently used ephemeral document beyond the cap", () => {
    vi.useFakeTimers();
    const { closesFor, gate } = createGate({ maxEphemeralDocuments: 2 });
    gate.holdEphemeral("file:///repo/a.ts");
    gate.holdEphemeral("file:///repo/b.ts");
    // a 续期后 b 成为最旧者。
    gate.holdEphemeral("file:///repo/a.ts");
    gate.holdEphemeral("file:///repo/c.ts");

    expect(closesFor("file:///repo/b.ts")).toHaveLength(1);
    expect(gate.ephemeralUris()).toEqual([
      "file:///repo/a.ts",
      "file:///repo/c.ts",
    ]);
    expect(LSP_MAX_EPHEMERAL_DOCUMENTS).toBeGreaterThan(0);
  });

  it("never closes a document that an editor still holds; editor close settles it", () => {
    vi.useFakeTimers();
    const { closesFor, didClose, didOpen, gate } = createGate();
    const uri = "file:///repo/shared.ts";
    gate.holdEphemeral(uri);
    didOpen("consumer-1", uri, "let a = 1;\n");

    vi.advanceTimersByTime(LSP_EPHEMERAL_DOCUMENT_TTL_MS + 1);
    // 短命引用到期但编辑器仍持有：不下发 didClose。
    expect(closesFor(uri)).toHaveLength(0);
    expect(gate.hasEditorRefs(uri)).toBe(true);

    didClose("consumer-1", uri);
    expect(closesFor(uri)).toHaveLength(1);
  });

  it("keeps the document open when the editor closes while an ephemeral ref is live", () => {
    vi.useFakeTimers();
    const { closesFor, didClose, didOpen, gate } = createGate();
    const uri = "file:///repo/shared.ts";
    didOpen("consumer-1", uri, "let a = 1;\n");
    gate.holdEphemeral(uri);

    didClose("consumer-1", uri);
    expect(closesFor(uri)).toHaveLength(0);

    vi.advanceTimersByTime(LSP_EPHEMERAL_DOCUMENT_TTL_MS + 1);
    expect(closesFor(uri)).toHaveLength(1);
  });

  it("releaseConsumer closes only uris without remaining editor or ephemeral refs", () => {
    const { closesFor, didOpen, gate } = createGate();
    didOpen("consumer-1", "file:///repo/only.ts", "a\n");
    didOpen("consumer-1", "file:///repo/shared.ts", "b\n");
    didOpen("consumer-2", "file:///repo/shared.ts", "b\n");
    gate.holdEphemeral("file:///repo/held.ts");
    didOpen("consumer-1", "file:///repo/held.ts", "c\n");

    gate.releaseConsumer("consumer-1");

    expect(closesFor("file:///repo/only.ts")).toHaveLength(1);
    expect(closesFor("file:///repo/shared.ts")).toHaveLength(0);
    expect(closesFor("file:///repo/held.ts")).toHaveLength(0);
  });

  it("clear cancels the sweep timer and drops all state silently", () => {
    vi.useFakeTimers();
    const { closesFor, gate } = createGate();
    gate.holdEphemeral("file:///repo/a.ts");
    gate.clear();
    vi.advanceTimersByTime(LSP_EPHEMERAL_DOCUMENT_TTL_MS * 2);
    expect(closesFor("file:///repo/a.ts")).toHaveLength(0);
    expect(gate.ephemeralUris()).toEqual([]);
  });
});
