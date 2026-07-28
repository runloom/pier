import { sanitizeMermaidSvg } from "./mermaid-svg-sanitizer.ts";

export { sanitizeMermaidSvg } from "./mermaid-svg-sanitizer.ts";

export type MermaidRenderResult =
  | { ok: true; svg: string }
  | { ok: false; reason: "render-failed" | "timeout" | "too-large" };

interface MermaidWorkerRequest {
  source: string;
}

interface MermaidWorkerResponse {
  error?: string;
  ok: boolean;
  svg?: string;
}

interface MermaidWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<MermaidWorkerResponse>) => void) | null;
  postMessage(message: MermaidWorkerRequest): void;
  terminate(): void;
}

export interface MermaidRenderer {
  render(source: string): Promise<MermaidRenderResult>;
}

export interface MermaidRendererOptions {
  createWorker(): MermaidWorkerLike;
  timeoutMs?: number;
}

const MAX_SOURCE_LENGTH = 160_000;
const MAX_CACHE_ENTRIES = 96;
export function createMermaidRenderer(
  options: MermaidRendererOptions
): MermaidRenderer {
  const cache = new Map<string, string>();
  const pending = new Map<string, Promise<MermaidRenderResult>>();
  const timeoutMs = options.timeoutMs ?? 2000;

  const remember = (key: string, svg: string) => {
    cache.delete(key);
    cache.set(key, svg);
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  return {
    render(source) {
      if (source.length > MAX_SOURCE_LENGTH) {
        return Promise.resolve({ ok: false, reason: "too-large" });
      }
      const cached = cache.get(source);
      if (cached !== undefined) {
        cache.delete(source);
        cache.set(source, cached);
        return Promise.resolve({ ok: true, svg: cached });
      }
      const existing = pending.get(source);
      if (existing) return existing;

      let worker: MermaidWorkerLike;
      try {
        worker = options.createWorker();
      } catch {
        return Promise.resolve({ ok: false, reason: "render-failed" });
      }
      const operation = new Promise<MermaidRenderResult>((resolve) => {
        let settled = false;
        const finish = (result: MermaidRenderResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          worker.terminate();
          resolve(result);
        };
        const timer = setTimeout(
          () => finish({ ok: false, reason: "timeout" }),
          timeoutMs
        );
        worker.onerror = () => finish({ ok: false, reason: "render-failed" });
        worker.onmessage = (event) => {
          if (!event.data.ok && event.data.error) {
            console.error("[mermaid-renderer] worker failed", event.data.error);
          }
          const svg = event.data.ok ? event.data.svg : undefined;
          const sanitized = svg ? sanitizeMermaidSvg(svg) : null;
          if (!sanitized) {
            finish({ ok: false, reason: "render-failed" });
            return;
          }
          remember(source, sanitized);
          finish({ ok: true, svg: sanitized });
        };
        try {
          worker.postMessage({ source });
        } catch {
          finish({ ok: false, reason: "render-failed" });
        }
      }).finally(() => {
        pending.delete(source);
      });
      pending.set(source, operation);
      return operation;
    },
  };
}

export const mermaidRenderer = createMermaidRenderer({
  createWorker: () =>
    new Worker(new URL("./mermaid-render.worker.ts", import.meta.url), {
      type: "module",
    }),
});
