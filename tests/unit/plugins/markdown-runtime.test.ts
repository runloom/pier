import type {
  MarkdownParseRequest,
  MarkdownParseResponse,
} from "@plugins/builtin/files/renderer/markdown/markdown-ir.ts";
import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/markdown-parser.ts";
import {
  createMarkdownRuntime,
  paginateMarkdownDocument,
} from "@plugins/builtin/files/renderer/markdown/markdown-runtime.ts";
import { describe, expect, it, vi } from "vitest";

class FakeMarkdownWorker {
  static instances: FakeMarkdownWorker[] = [];
  messages: MarkdownParseRequest[] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<MarkdownParseResponse>) => void) | null =
    null;
  terminate = vi.fn();

  constructor() {
    FakeMarkdownWorker.instances.push(this);
  }

  postMessage(message: MarkdownParseRequest) {
    this.messages.push(message);
  }

  respond(response: MarkdownParseResponse) {
    this.onmessage?.(new MessageEvent("message", { data: response }));
  }
}

function parsedResponse(request: MarkdownParseRequest): MarkdownParseResponse {
  return {
    document: parseMarkdownToIr(request.source),
    requestId: request.requestId,
    revision: request.revision,
    sessionId: request.sessionId,
    type: "parsed",
  };
}

function setupRuntime() {
  FakeMarkdownWorker.instances = [];
  return createMarkdownRuntime({
    createWorker: () => new FakeMarkdownWorker(),
    timeoutMs: 5000,
  });
}

describe("Markdown multi-session runtime", () => {
  it("cancels an active stale revision and ignores the terminated worker", async () => {
    const runtime = setupRuntime();
    const first = runtime.parse({
      revision: "r1",
      sessionId: "a",
      source: "# Old",
    });
    const firstWorker = FakeMarkdownWorker.instances[0];
    const lateWorkerError = firstWorker?.onerror;
    const second = runtime.parse({
      revision: "r2",
      sessionId: "a",
      source: "# New",
    });

    await expect(first).resolves.toEqual({
      revision: "r1",
      status: "superseded",
    });
    expect(firstWorker?.terminate).toHaveBeenCalledOnce();
    const secondWorker = FakeMarkdownWorker.instances[1];
    lateWorkerError?.(new ErrorEvent("error"));
    expect(secondWorker?.terminate).not.toHaveBeenCalled();
    const request = secondWorker?.messages[0];
    expect(request).toMatchObject({ revision: "r2", sessionId: "a" });
    if (!request) throw new Error("missing latest parse request");
    secondWorker.respond(parsedResponse(request));
    await expect(second).resolves.toMatchObject({
      document: { headings: [expect.objectContaining({ text: "New" })] },
      revision: "r2",
      status: "parsed",
    });
  });

  it("prioritizes visible sessions while preserving queued session order", async () => {
    const runtime = setupRuntime();
    runtime.setSessionVisible("background", false);
    runtime.setSessionVisible("visible", true);
    const active = runtime.parse({
      revision: "a1",
      sessionId: "active",
      source: "A",
    });
    const background = runtime.parse({
      revision: "b1",
      sessionId: "background",
      source: "B",
    });
    const visible = runtime.parse({
      revision: "v1",
      sessionId: "visible",
      source: "V",
    });
    const worker = FakeMarkdownWorker.instances[0];
    const activeRequest = worker?.messages[0];
    if (!activeRequest) throw new Error("missing active request");
    worker.respond(parsedResponse(activeRequest));
    await active;

    expect(worker.messages[1]).toMatchObject({ sessionId: "visible" });
    const visibleRequest = worker.messages[1];
    if (!visibleRequest) throw new Error("missing visible request");
    worker.respond(parsedResponse(visibleRequest));
    await visible;
    expect(worker.messages[2]).toMatchObject({ sessionId: "background" });
    const backgroundRequest = worker.messages[2];
    if (!backgroundRequest) throw new Error("missing background request");
    worker.respond(parsedResponse(backgroundRequest));
    await background;
  });

  it("closes queued sessions and rejects oversized payloads before dispatch", async () => {
    const runtime = setupRuntime();
    const active = runtime.parse({
      revision: "a1",
      sessionId: "active",
      source: "A",
    });
    const queued = runtime.parse({
      revision: "q1",
      sessionId: "queued",
      source: "Q",
    });
    runtime.closeSession("queued");
    await expect(queued).resolves.toEqual({ revision: "q1", status: "closed" });

    const oversized = runtime.parse({
      revision: "large",
      sessionId: "large",
      source: "界".repeat(3_500_000),
    });
    await expect(oversized).resolves.toEqual({
      code: "too-large",
      revision: "large",
      status: "error",
    });
    expect(FakeMarkdownWorker.instances[0]?.messages).toHaveLength(1);
    runtime.dispose();
    await expect(active).resolves.toEqual({ revision: "a1", status: "closed" });
  });

  it("supersedes older work before reporting an oversized latest revision", async () => {
    const runtime = setupRuntime();
    const active = runtime.parse({
      revision: "r1",
      sessionId: "same",
      source: "old",
    });
    const oversized = runtime.parse({
      revision: "r2",
      sessionId: "same",
      source: "界".repeat(3_500_000),
    });
    await expect(active).resolves.toEqual({
      revision: "r1",
      status: "superseded",
    });
    await expect(oversized).resolves.toEqual({
      code: "too-large",
      revision: "r2",
      status: "error",
    });

    const blocker = runtime.parse({
      revision: "b1",
      sessionId: "blocker",
      source: "B",
    });
    const queued = runtime.parse({
      revision: "q1",
      sessionId: "queued",
      source: "Q",
    });
    const queuedOversized = runtime.parse({
      revision: "q2",
      sessionId: "queued",
      source: "界".repeat(3_500_000),
    });
    await expect(queued).resolves.toEqual({
      revision: "q1",
      status: "superseded",
    });
    await expect(queuedOversized).resolves.toMatchObject({
      code: "too-large",
      revision: "q2",
      status: "error",
    });
    runtime.dispose();
    await blocker;
  });

  it("reports worker construction failures as parse errors", async () => {
    const runtime = createMarkdownRuntime({
      createWorker: () => {
        throw new Error("worker unavailable");
      },
    });

    await expect(
      runtime.parse({
        revision: "r1",
        sessionId: "worker-failure",
        source: "# Test",
      })
    ).resolves.toEqual({
      code: "worker-failed",
      revision: "r1",
      status: "error",
    });
  });
});

describe("Markdown semantic pagination", () => {
  it("keeps headings with following content and preserves every top-level block", () => {
    const document = parseMarkdownToIr(
      ["# First", "", "1234567890", "", "# Second", "", "abcdefghij"].join("\n")
    );
    const pagination = paginateMarkdownDocument(document, {
      maxBlocks: 2,
      targetSourceLength: 15,
    });

    expect(pagination.pages.length).toBeGreaterThan(1);
    expect(pagination.pages.flatMap((page) => page.blocks)).toEqual(
      document.blocks
    );
    for (const page of pagination.pages) {
      expect(page.blocks.at(-1)?.kind).not.toBe("heading");
      expect(page.range.startOffset).toBe(page.blocks[0]?.range.startOffset);
      expect(page.range.endOffset).toBe(page.blocks.at(-1)?.range.endOffset);
    }
    expect(pagination.pageByHeadingId.first).toBe(0);
    expect(pagination.pageByHeadingId.second).toBeGreaterThan(0);
  });

  it("moves consecutive heading runs and safely indexes special heading ids", () => {
    const document = parseMarkdownToIr(
      "# A\n## B\ntext\n\n# \\_\\_proto\\_\\_\nbody"
    );
    const pagination = paginateMarkdownDocument(document, {
      maxBlocks: 2,
      targetSourceLength: 20,
    });

    for (const page of pagination.pages) {
      expect(page.blocks.at(-1)?.kind).not.toBe("heading");
    }
    expect(Object.hasOwn(pagination.pageByHeadingId, "__proto__")).toBe(true);
    expect(
      Reflect.get(pagination.pageByHeadingId, "__proto__")
    ).toBeGreaterThanOrEqual(0);
  });

  it("keeps an oversized semantic block intact on its own page", () => {
    const document = parseMarkdownToIr(
      ["before", "", "x".repeat(100), "", "after"].join("\n")
    );
    const pagination = paginateMarkdownDocument(document, {
      maxBlocks: 10,
      targetSourceLength: 20,
    });

    expect(
      pagination.pages.some((page) => {
        const block = page.blocks[0];
        return (
          page.blocks.length === 1 &&
          block !== undefined &&
          block.range.endOffset - block.range.startOffset >= 100
        );
      })
    ).toBe(true);
  });
});
