import type {
  MarkdownCodeHighlightRequest,
  MarkdownCodeHighlightResponse,
} from "@plugins/builtin/files/renderer/markdown/code-highlight-protocol.ts";
import {
  createMarkdownCodeHighlighter,
  type MarkdownCodeHighlightWorker,
} from "@plugins/builtin/files/renderer/markdown/code-highlighter.ts";
import { describe, expect, it, vi } from "vitest";
import { PIER_BRAND_PALETTE } from "@/lib/theme/pierre-brand-overlay.ts";
import { getShikiTheme } from "@/lib/theme/preset-registry.ts";

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

  it("posts a matching raw theme registration once per worker lifetime", async () => {
    const worker = new FakeHighlightWorker();
    const runtime = createMarkdownCodeHighlighter({
      createWorker: () => worker,
    });
    const sourceTheme = getShikiTheme("pierre", "dark");
    const theme = sourceTheme.name;
    if (!theme) throw new Error("missing Pierre theme name");
    const themeRegistration = { ...sourceTheme, name: theme };

    const first = runtime.highlight({
      code: "@first",
      language: "ts",
      theme,
      themeRegistration,
    });
    const second = runtime.highlight({
      code: "@second",
      language: "ts",
      theme,
      themeRegistration,
    });

    expect(worker.requests[0]).toMatchObject({ theme, themeRegistration });
    expect(worker.requests[1]).toEqual(
      expect.not.objectContaining({ themeRegistration: expect.anything() })
    );
    for (const request of worker.requests) {
      worker.respond({ requestId: request.requestId, type: "error" });
    }
    await expect(first).resolves.toEqual({ status: "plain" });
    await expect(second).resolves.toEqual({ status: "plain" });
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

  it("retains a theme registration received with an unsupported request", async () => {
    const sourceTheme = getShikiTheme("pierre", "dark");
    const theme = "pierre-unsupported-first-test-dark";
    const themeRegistration = { ...sourceTheme, name: theme };
    const unsupportedRequest: MarkdownCodeHighlightRequest = {
      code: "ignored",
      language: "definitely-not-supported",
      requestId: "markdown-unsupported-first",
      theme,
      themeRegistration,
      type: "highlight",
    };
    const supportedRequest: MarkdownCodeHighlightRequest = {
      code: "@sealed\nclass Example {}",
      language: "ts",
      requestId: "markdown-supported-second",
      theme,
      type: "highlight",
    };

    await import(
      "@plugins/builtin/files/renderer/markdown/code-highlight.worker.ts"
    );
    const dispatch = (request: MarkdownCodeHighlightRequest) => {
      const response = new Promise<MarkdownCodeHighlightResponse>((resolve) => {
        const originalPostMessage = self.postMessage;
        Object.defineProperty(self, "postMessage", {
          configurable: true,
          value: (message: MarkdownCodeHighlightResponse) => {
            Object.defineProperty(self, "postMessage", {
              configurable: true,
              value: originalPostMessage,
              writable: true,
            });
            resolve(message);
          },
          writable: true,
        });
      });
      if (typeof self.onmessage !== "function") {
        throw new Error("missing Markdown highlight worker handler");
      }
      self.onmessage(new MessageEvent("message", { data: request }));
      return response;
    };

    expect(unsupportedRequest).toMatchObject({ themeRegistration });
    expect(supportedRequest).not.toEqual(
      expect.objectContaining({ themeRegistration: expect.anything() })
    );
    await expect(dispatch(unsupportedRequest)).resolves.toEqual({
      requestId: unsupportedRequest.requestId,
      type: "error",
    });

    const outcome = await dispatch(supportedRequest);
    expect(outcome.type).toBe("highlighted");
    if (outcome.type !== "highlighted") {
      throw new Error("Markdown highlighting failed");
    }
    const decoratorToken = outcome.lines[0]?.[0];
    expect(decoratorToken?.content).toContain("@");
    expect(decoratorToken?.color?.toLowerCase()).toBe(
      PIER_BRAND_PALETTE.highlight
    );
  });

  it.each([
    ["dark", PIER_BRAND_PALETTE.highlight],
    ["light", PIER_BRAND_PALETTE.primary],
  ] as const)("tokenizes decorator punctuation with the %s Pierre registration", async (mode, expectedColor) => {
    const registration = getShikiTheme("pierre", mode);
    const request = {
      code: "@sealed\nclass Example {}",
      language: "ts",
      requestId: `markdown-pierre-${mode}`,
      theme: registration.name ?? `pierre-${mode}`,
      themeRegistration: registration,
      type: "highlight" as const,
    };
    const response = new Promise<MarkdownCodeHighlightResponse>((resolve) => {
      const originalPostMessage = self.postMessage;
      Object.defineProperty(self, "postMessage", {
        configurable: true,
        value: (message: MarkdownCodeHighlightResponse) => {
          Object.defineProperty(self, "postMessage", {
            configurable: true,
            value: originalPostMessage,
            writable: true,
          });
          resolve(message);
        },
        writable: true,
      });
    });

    await import(
      "@plugins/builtin/files/renderer/markdown/code-highlight.worker.ts"
    );
    if (typeof self.onmessage !== "function") {
      throw new Error("missing Markdown highlight worker handler");
    }
    self.onmessage(new MessageEvent("message", { data: request }));

    const outcome = await response;
    expect(outcome.type).toBe("highlighted");
    if (outcome.type !== "highlighted") {
      throw new Error("Markdown highlighting failed");
    }
    const decoratorToken = outcome.lines[0]?.[0];
    expect(decoratorToken?.content).toContain("@");
    expect(decoratorToken?.color?.toLowerCase()).toBe(expectedColor);
  });
});
