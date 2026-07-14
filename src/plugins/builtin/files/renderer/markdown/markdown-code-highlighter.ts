import type {
  MarkdownCodeHighlightRequest,
  MarkdownCodeHighlightResponse,
  MarkdownCodeHighlightToken,
} from "./markdown-code-highlight-protocol.ts";
import { markdownSourceFitsByteLimit } from "./markdown-parser.ts";

const MAX_HIGHLIGHT_BYTES = 512 * 1024;
const DEFAULT_HIGHLIGHT_TIMEOUT_MS = 30_000;

export interface MarkdownCodeHighlightWorker {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage:
    | ((event: MessageEvent<MarkdownCodeHighlightResponse>) => void)
    | null;
  postMessage(request: MarkdownCodeHighlightRequest): void;
  terminate(): void;
}

export interface MarkdownCodeHighlightInput {
  code: string;
  language: string | null;
  theme: string;
}

export type MarkdownCodeHighlightOutcome =
  | { status: "plain" }
  | {
      background: string;
      foreground: string;
      lines: MarkdownCodeHighlightToken[][];
      status: "highlighted";
    };

export interface MarkdownCodeHighlighter {
  dispose(): void;
  highlight(
    input: MarkdownCodeHighlightInput
  ): Promise<MarkdownCodeHighlightOutcome>;
}

interface PendingHighlight {
  resolve(outcome: MarkdownCodeHighlightOutcome): void;
  timeoutId: number;
}

export function createMarkdownCodeHighlighter(options: {
  createWorker(): MarkdownCodeHighlightWorker;
  timeoutMs?: number;
}): MarkdownCodeHighlighter {
  const pending = new Map<string, PendingHighlight>();
  const timeoutMs = options.timeoutMs ?? DEFAULT_HIGHLIGHT_TIMEOUT_MS;
  let disposed = false;
  let requestSequence = 0;
  let worker: MarkdownCodeHighlightWorker | null = null;

  const settleAllPlain = () => {
    for (const item of pending.values()) {
      window.clearTimeout(item.timeoutId);
      item.resolve({ status: "plain" });
    }
    pending.clear();
  };

  const stopWorker = () => {
    const current = worker;
    worker = null;
    if (current) {
      current.onerror = null;
      current.onmessage = null;
      current.terminate();
    }
  };

  const failWorker = () => {
    stopWorker();
    settleAllPlain();
  };

  const ensureWorker = (): MarkdownCodeHighlightWorker | null => {
    if (worker) return worker;
    try {
      const created = options.createWorker();
      created.onmessage = (event) => {
        if (worker !== created) return;
        const item = pending.get(event.data.requestId);
        if (!item) return;
        pending.delete(event.data.requestId);
        window.clearTimeout(item.timeoutId);
        if (event.data.type === "highlighted") {
          item.resolve({
            background: event.data.background,
            foreground: event.data.foreground,
            lines: event.data.lines,
            status: "highlighted",
          });
        } else {
          item.resolve({ status: "plain" });
        }
      };
      created.onerror = failWorker;
      worker = created;
      return created;
    } catch {
      return null;
    }
  };

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stopWorker();
      settleAllPlain();
    },

    highlight(input) {
      if (
        disposed ||
        !input.language?.trim() ||
        !markdownSourceFitsByteLimit(input.code, MAX_HIGHLIGHT_BYTES)
      ) {
        return Promise.resolve({ status: "plain" });
      }
      const currentWorker = ensureWorker();
      if (!currentWorker) return Promise.resolve({ status: "plain" });
      requestSequence += 1;
      const request: MarkdownCodeHighlightRequest = {
        code: input.code,
        language: input.language,
        requestId: `markdown-highlight-${requestSequence}`,
        theme: input.theme,
        type: "highlight",
      };
      return new Promise<MarkdownCodeHighlightOutcome>((resolve) => {
        const timeoutId = window.setTimeout(failWorker, timeoutMs);
        pending.set(request.requestId, { resolve, timeoutId });
        try {
          currentWorker.postMessage(request);
        } catch {
          failWorker();
        }
      });
    },
  };
}

export const markdownCodeHighlighter = createMarkdownCodeHighlighter({
  createWorker: () =>
    new Worker(
      new URL("./markdown-code-highlight.worker.ts", import.meta.url),
      {
        type: "module",
      }
    ),
});
