import type {
  MarkdownBlock,
  MarkdownIrDocument,
  MarkdownParseRequest,
  MarkdownParseResponse,
  MarkdownSourceRange,
} from "./markdown-ir.ts";
import { markdownSourceFitsByteLimit } from "./markdown-parser.ts";

interface MarkdownWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<MarkdownParseResponse>) => void) | null;
  postMessage(request: MarkdownParseRequest): void;
  terminate(): void;
}

export interface MarkdownRuntimeOptions {
  createWorker(): MarkdownWorkerLike;
  timeoutMs?: number;
}

export interface MarkdownRuntimeParseInput {
  revision: string;
  sessionId: string;
  source: string;
}

export type MarkdownRuntimeParseOutcome =
  | {
      document: MarkdownIrDocument;
      pagination: MarkdownPagination;
      revision: string;
      status: "parsed";
    }
  | {
      code: "parse-failed" | "too-large" | "worker-failed";
      revision: string;
      status: "error";
    }
  | { revision: string; status: "closed" | "superseded" };

export interface MarkdownRuntime {
  closeSession(sessionId: string): void;
  dispose(): void;
  parse(input: MarkdownRuntimeParseInput): Promise<MarkdownRuntimeParseOutcome>;
  setSessionVisible(sessionId: string, visible: boolean): void;
}

interface ParseJob {
  input: MarkdownRuntimeParseInput;
  request: MarkdownParseRequest;
  resolve(outcome: MarkdownRuntimeParseOutcome): void;
  settled: boolean;
}

export interface MarkdownSemanticPage {
  blocks: MarkdownBlock[];
  id: string;
  index: number;
  range: MarkdownSourceRange;
}

export interface MarkdownPagination {
  pageByHeadingId: Record<string, number>;
  pages: MarkdownSemanticPage[];
}

export interface MarkdownPaginationOptions {
  maxBlocks?: number;
  targetSourceLength?: number;
}

const DEFAULT_MAX_BLOCKS = 96;
const DEFAULT_TARGET_SOURCE_LENGTH = 48 * 1024;
const DEFAULT_PARSE_TIMEOUT_MS = 10_000;

export function paginateMarkdownDocument(
  document: MarkdownIrDocument,
  options: MarkdownPaginationOptions = {}
): MarkdownPagination {
  const maxBlocks = Math.max(1, options.maxBlocks ?? DEFAULT_MAX_BLOCKS);
  const targetSourceLength = Math.max(
    1,
    options.targetSourceLength ?? DEFAULT_TARGET_SOURCE_LENGTH
  );
  const pages: MarkdownSemanticPage[] = [];
  let current: MarkdownBlock[] = [];

  const flush = () => {
    const first = current[0];
    const last = current.at(-1);
    if (!(first && last)) return;
    const index = pages.length;
    pages.push({
      blocks: current,
      id: `markdown-page-${first.range.startOffset}-${last.range.endOffset}`,
      index,
      range: {
        endLine: last.range.endLine,
        endOffset: last.range.endOffset,
        startLine: first.range.startLine,
        startOffset: first.range.startOffset,
      },
    });
    current = [];
  };

  for (const block of document.blocks) {
    const first = current[0];
    const projectedLength = first
      ? block.range.endOffset - first.range.startOffset
      : block.range.endOffset - block.range.startOffset;
    const exceedsLimit =
      current.length >= maxBlocks || projectedLength > targetSourceLength;
    if (exceedsLimit && current.length > 0) {
      let trailingHeadingStart = current.length;
      while (
        trailingHeadingStart > 0 &&
        current[trailingHeadingStart - 1]?.kind === "heading"
      ) {
        trailingHeadingStart -= 1;
      }
      if (trailingHeadingStart > 0 && trailingHeadingStart < current.length) {
        const trailingHeadings = current.splice(trailingHeadingStart);
        flush();
        current.push(...trailingHeadings);
      } else if (trailingHeadingStart === current.length) {
        flush();
      }
    }
    current.push(block);
  }
  flush();

  const pageByHeadingId = Object.create(null) as Record<string, number>;
  let headingPageIndex = 0;
  for (const heading of document.headings) {
    while (
      headingPageIndex + 1 < pages.length &&
      heading.range.startOffset >
        (pages[headingPageIndex]?.range.endOffset ?? Number.POSITIVE_INFINITY)
    ) {
      headingPageIndex += 1;
    }
    const page = pages[headingPageIndex];
    if (
      page &&
      heading.range.startOffset >= page.range.startOffset &&
      heading.range.startOffset <= page.range.endOffset
    ) {
      pageByHeadingId[heading.id] = page.index;
    }
  }
  return { pageByHeadingId, pages };
}

export function createMarkdownRuntime(
  options: MarkdownRuntimeOptions
): MarkdownRuntime {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
  const queuedBySession = new Map<string, ParseJob>();
  const visibleBySession = new Map<string, boolean>();
  let active: ParseJob | null = null;
  let disposed = false;
  let requestSequence = 0;
  let worker: MarkdownWorkerLike | null = null;
  let timeoutId: number | null = null;

  const settle = (job: ParseJob, outcome: MarkdownRuntimeParseOutcome) => {
    if (job.settled) return;
    job.settled = true;
    job.resolve(outcome);
  };

  const clearActiveTimeout = () => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const stopWorker = () => {
    clearActiveTimeout();
    const current = worker;
    worker = null;
    if (current) {
      current.onmessage = null;
      current.onerror = null;
      current.terminate();
    }
  };

  const selectNext = (): ParseJob | null => {
    let fallback: ParseJob | null = null;
    for (const job of queuedBySession.values()) {
      fallback ??= job;
      if (visibleBySession.get(job.input.sessionId) !== false) {
        return job;
      }
    }
    return fallback;
  };

  const pump = () => {
    if (disposed || active) return;
    const next = selectNext();
    if (!next) return;
    queuedBySession.delete(next.input.sessionId);
    active = next;

    if (!worker) {
      try {
        const created = options.createWorker();
        created.onmessage = (event) => {
          if (worker !== created) return;
          const job = active;
          const response = event.data;
          if (
            !job ||
            response.requestId !== job.request.requestId ||
            response.sessionId !== job.request.sessionId ||
            response.revision !== job.request.revision
          ) {
            return;
          }
          clearActiveTimeout();
          active = null;
          if (response.type === "parsed") {
            settle(job, {
              document: response.document,
              pagination: paginateMarkdownDocument(response.document),
              revision: response.revision,
              status: "parsed",
            });
          } else {
            settle(job, {
              code: response.code,
              revision: response.revision,
              status: "error",
            });
          }
          pump();
        };
        created.onerror = () => {
          if (worker !== created) return;
          const job = active;
          active = null;
          stopWorker();
          if (job) {
            settle(job, {
              code: "worker-failed",
              revision: job.input.revision,
              status: "error",
            });
          }
          pump();
        };
        worker = created;
      } catch {
        const job = active;
        active = null;
        if (job) {
          settle(job, {
            code: "worker-failed",
            revision: job.input.revision,
            status: "error",
          });
        }
        pump();
        return;
      }
    }

    const scheduledWorker = worker;
    timeoutId = window.setTimeout(() => {
      if (active !== next || worker !== scheduledWorker) return;
      const job = active;
      active = null;
      stopWorker();
      if (job) {
        settle(job, {
          code: "worker-failed",
          revision: job.input.revision,
          status: "error",
        });
      }
      pump();
    }, timeoutMs);
    try {
      worker.postMessage(next.request);
    } catch {
      const job = active;
      active = null;
      stopWorker();
      if (job) {
        settle(job, {
          code: "worker-failed",
          revision: job.input.revision,
          status: "error",
        });
      }
      pump();
    }
  };

  return {
    closeSession(sessionId) {
      visibleBySession.delete(sessionId);
      const queued = queuedBySession.get(sessionId);
      if (queued) {
        queuedBySession.delete(sessionId);
        settle(queued, { revision: queued.input.revision, status: "closed" });
      }
      if (active?.input.sessionId === sessionId) {
        const closing = active;
        active = null;
        settle(closing, { revision: closing.input.revision, status: "closed" });
        stopWorker();
        pump();
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (active) {
        settle(active, { revision: active.input.revision, status: "closed" });
        active = null;
      }
      for (const job of queuedBySession.values()) {
        settle(job, { revision: job.input.revision, status: "closed" });
      }
      queuedBySession.clear();
      visibleBySession.clear();
      stopWorker();
    },

    parse(input) {
      if (disposed) {
        return Promise.resolve({ revision: input.revision, status: "closed" });
      }
      const oversized = !markdownSourceFitsByteLimit(input.source);
      return new Promise<MarkdownRuntimeParseOutcome>((resolve) => {
        const queued = queuedBySession.get(input.sessionId);
        if (queued) {
          queuedBySession.delete(input.sessionId);
          settle(queued, {
            revision: queued.input.revision,
            status: "superseded",
          });
        }
        if (active?.input.sessionId === input.sessionId) {
          const superseded = active;
          active = null;
          settle(superseded, {
            revision: superseded.input.revision,
            status: "superseded",
          });
          stopWorker();
        }
        if (oversized) {
          resolve({
            code: "too-large",
            revision: input.revision,
            status: "error",
          });
          pump();
          return;
        }
        requestSequence += 1;
        const request: MarkdownParseRequest = {
          requestId: `markdown-parse-${requestSequence}`,
          revision: input.revision,
          sessionId: input.sessionId,
          source: input.source,
          type: "parse",
        };
        queuedBySession.set(input.sessionId, {
          input,
          request,
          resolve,
          settled: false,
        });
        pump();
      });
    },

    setSessionVisible(sessionId, visible) {
      visibleBySession.set(sessionId, visible);
    },
  };
}

export const markdownRuntime = createMarkdownRuntime({
  createWorker: () =>
    new Worker(new URL("./markdown-parse.worker.ts", import.meta.url), {
      type: "module",
    }),
});
