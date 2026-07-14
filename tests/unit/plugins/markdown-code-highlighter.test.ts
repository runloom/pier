import type {
  MarkdownCodeHighlightRequest,
  MarkdownCodeHighlightResponse,
} from "@plugins/builtin/files/renderer/markdown/markdown-code-highlight-protocol.ts";
import {
  createMarkdownCodeHighlighter,
  type MarkdownCodeHighlightWorker,
} from "@plugins/builtin/files/renderer/markdown/markdown-code-highlighter.ts";
import { describe, expect, it, vi } from "vitest";

class FakeHighlightWorker implements MarkdownCodeHighlightWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage:
    | ((event: MessageEvent<MarkdownCodeHighlightResponse>) => void)
    | null = null;
  requests: MarkdownCodeHighlightRequest[] = [];
  terminate = vi.fn();

  postMessage(request: MarkdownCodeHighlightRequest) {
    this.requests.push(request);
  }

  respond(response: MarkdownCodeHighlightResponse) {
    this.onmessage?.(new MessageEvent("message", { data: response }));
  }
}

describe("Markdown code highlighter runtime", () => {
  it("shares one worker and resolves serialized Shiki tokens", async () => {
    const worker = new FakeHighlightWorker();
    const runtime = createMarkdownCodeHighlighter({
      createWorker: () => worker,
    });
    const first = runtime.highlight({
      code: "const x = 1",
      language: "ts",
      theme: "github-dark",
    });
    const second = runtime.highlight({
      code: "echo ok",
      language: "bash",
      theme: "github-dark",
    });

    expect(worker.requests).toHaveLength(2);
    const firstRequest = worker.requests[0];
    const secondRequest = worker.requests[1];
    if (!(firstRequest && secondRequest))
      throw new Error("missing highlight requests");
    worker.respond({
      background: "#000000",
      foreground: "#ffffff",
      lines: [[{ color: "#ff0000", content: "const" }, { content: " x = 1" }]],
      requestId: firstRequest.requestId,
      type: "highlighted",
    });
    worker.respond({
      background: "#000000",
      foreground: "#ffffff",
      lines: [[{ content: "echo ok" }]],
      requestId: secondRequest.requestId,
      type: "highlighted",
    });

    await expect(first).resolves.toMatchObject({
      lines: [[{ color: "#ff0000", content: "const" }, { content: " x = 1" }]],
      status: "highlighted",
    });
    await expect(second).resolves.toMatchObject({ status: "highlighted" });
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("falls back without dispatching oversized or untyped code", async () => {
    const worker = new FakeHighlightWorker();
    const runtime = createMarkdownCodeHighlighter({
      createWorker: () => worker,
    });

    await expect(
      runtime.highlight({ code: "plain", language: null, theme: "github-dark" })
    ).resolves.toEqual({ status: "plain" });
    await expect(
      runtime.highlight({
        code: "界".repeat(200_000),
        language: "ts",
        theme: "github-dark",
      })
    ).resolves.toEqual({ status: "plain" });
    expect(worker.requests).toHaveLength(0);
  });

  it("settles pending work and restarts after worker failure", async () => {
    const workers: FakeHighlightWorker[] = [];
    const runtime = createMarkdownCodeHighlighter({
      createWorker: () => {
        const worker = new FakeHighlightWorker();
        workers.push(worker);
        return worker;
      },
    });
    const failed = runtime.highlight({
      code: "x",
      language: "ts",
      theme: "github-dark",
    });
    workers[0]?.onerror?.(new ErrorEvent("error"));
    await expect(failed).resolves.toEqual({ status: "plain" });
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();

    const recovered = runtime.highlight({
      code: "y",
      language: "ts",
      theme: "github-dark",
    });
    const request = workers[1]?.requests[0];
    if (!request) throw new Error("missing recovered request");
    workers[1]?.respond({
      background: "#000000",
      foreground: "#ffffff",
      lines: [[{ content: "y" }]],
      requestId: request.requestId,
      type: "highlighted",
    });
    await expect(recovered).resolves.toMatchObject({ status: "highlighted" });
  });
});
