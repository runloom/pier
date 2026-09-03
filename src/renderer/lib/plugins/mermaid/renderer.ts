import { prepareMermaidSource } from "@pier/ui/mermaid/source-prepare.ts";
import { renderMermaid } from "@pier/ui/mermaid/theme.ts";

export type MermaidRenderResult =
  | { ok: true; svg: string }
  | { ok: false; reason: "render-failed" | "timeout" | "too-large" };

export interface MermaidRenderer {
  render(source: string): Promise<MermaidRenderResult>;
}

export interface MermaidRendererOptions {
  /** Injectable for tests; defaults to the shared official-engine renderer. */
  renderSvg?(id: string, source: string): Promise<{ svg: string }>;
  timeoutMs?: number;
}

const MAX_SOURCE_LENGTH = 160_000;
const MAX_CACHE_ENTRIES = 96;
const DEFAULT_TIMEOUT_MS = 10_000;

class RenderTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RenderTimeoutError("mermaid render timed out")),
      timeoutMs
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

let renderCounter = 0;

/**
 * Plugin-facade mermaid renderer. Single engine everywhere: markdown inline,
 * fullscreen preview and canvas visualizations all render through the shared
 * official-mermaid singleton in `@pier/ui/mermaid/theme.ts`, so a diagram
 * looks identical inline and fullscreen. Rendering happens on the renderer
 * main thread because the official engine measures text in the DOM (which is
 * also what keeps CJK / mixed-script node sizing correct).
 *
 * Safety layers for user-authored sources: `securityLevel: "antiscript"`
 * (DOMPurify inside mermaid) plus the insertion-side `parseSafeSvg` strip in
 * the markdown preview shell.
 */
export function createMermaidRenderer(
  options: MermaidRendererOptions = {}
): MermaidRenderer {
  const renderSvg = options.renderSvg ?? renderMermaid;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = new Map<string, string>();
  const pending = new Map<string, Promise<MermaidRenderResult>>();

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

      renderCounter += 1;
      const renderId = `md-inline-${renderCounter}`;
      const operation = withTimeout(
        renderSvg(renderId, prepareMermaidSource(source)),
        timeoutMs
      )
        .then((result): MermaidRenderResult => {
          remember(source, result.svg);
          return { ok: true, svg: result.svg };
        })
        .catch((error: unknown): MermaidRenderResult => {
          if (error instanceof RenderTimeoutError) {
            console.error("[mermaid-renderer] render timed out");
            return { ok: false, reason: "timeout" };
          }
          console.error(
            "[mermaid-renderer] render failed",
            error instanceof Error ? error.message : error
          );
          return { ok: false, reason: "render-failed" };
        })
        .finally(() => {
          pending.delete(source);
        });
      pending.set(source, operation);
      return operation;
    },
  };
}

export const mermaidRenderer = createMermaidRenderer();
