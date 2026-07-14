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
const DISALLOWED_SVG_ELEMENTS = "script,foreignObject,iframe,object,embed";
const URL_PRESENTATION_ATTRIBUTES = new Set([
  "clip-path",
  "cursor",
  "fill",
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
]);

function hasUnsafeCssUrl(value: string): boolean {
  if (value.includes("\\")) {
    return true;
  }
  const matches = value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu);
  for (const match of matches) {
    if (!match[2]?.trim().startsWith("#")) {
      return true;
    }
  }
  return false;
}

function sanitizeMermaidSvg(svg: string): string | null {
  const documentNode = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = documentNode.documentElement;
  if (
    root.localName !== "svg" ||
    documentNode.querySelector("parsererror") ||
    documentNode.querySelector(DISALLOWED_SVG_ELEMENTS)
  ) {
    return null;
  }

  let changed = false;
  for (const styleElement of root.querySelectorAll("style")) {
    const original = styleElement.textContent ?? "";
    const withoutImports = original.replace(
      /@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*;?/giu,
      ""
    );
    const normalizedFonts = withoutImports.replace(
      /font-family\s*:[^;}]+/giu,
      "font-family:var(--font-sans)"
    );
    if (hasUnsafeCssUrl(normalizedFonts)) {
      return null;
    }
    if (normalizedFonts !== original) {
      styleElement.textContent = normalizedFonts;
      changed = true;
    }
  }

  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        return null;
      }
      if (
        (name === "href" || name === "xlink:href" || name === "src") &&
        value !== "" &&
        !value.startsWith("#")
      ) {
        return null;
      }
      if (
        (name === "style" || URL_PRESENTATION_ATTRIBUTES.has(name)) &&
        (hasUnsafeCssUrl(value) || /expression\s*\(/iu.test(value))
      ) {
        return null;
      }
    }
  }
  return changed ? new XMLSerializer().serializeToString(root) : svg;
}

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
