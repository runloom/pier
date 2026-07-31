import type { MermaidConfig } from "mermaid";
import { sanitizeMermaidSvg } from "@/lib/plugins/mermaid/svg-sanitizer.ts";

export type OfficialMermaidRenderResult =
  | { diagramType: string; ok: true; svg: string }
  | {
      message: string;
      ok: false;
      reason: "empty" | "render-failed" | "too-large";
    };

const MAX_SOURCE_LENGTH = 160_000;
const MAX_CACHE_ENTRIES = 64;
const cache = new Map<string, { diagramType: string; svg: string }>();
let renderSequence = 0;
let renderQueue: Promise<void> = Promise.resolve();

function remember(
  key: string,
  value: { diagramType: string; svg: string }
): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/^Error:\s*/u, "")
      .replace(/\s+at\s+.*$/su, "")
      .trim()
      .split("\n")
      .slice(0, 4)
      .join("\n") || "Mermaid syntax could not be rendered."
  );
}

function configForTheme(theme: "dark" | "light"): MermaidConfig {
  return {
    flowchart: {
      htmlLabels: false,
      useMaxWidth: true,
    },
    fontFamily: "var(--font-sans)",
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: theme === "dark" ? "dark" : "default",
  };
}

async function performRender(
  source: string,
  theme: "dark" | "light"
): Promise<OfficialMermaidRenderResult> {
  const cacheKey = `${theme}\0${source}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return { ...cached, ok: true };
  }

  try {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize(configForTheme(theme));
    const parsed = await mermaid.parse(source);
    renderSequence += 1;
    const id = `pier-mermaid-${renderSequence}`;
    const { svg } = await mermaid.render(id, source);
    const sanitized = sanitizeMermaidSvg(svg);
    if (!sanitized) {
      return {
        message: "Mermaid produced unsafe or invalid SVG.",
        ok: false,
        reason: "render-failed",
      };
    }
    const value = { diagramType: parsed.diagramType, svg: sanitized };
    remember(cacheKey, value);
    return { ...value, ok: true };
  } catch (error) {
    return {
      message: readableError(error),
      ok: false,
      reason: "render-failed",
    };
  }
}

/**
 * Official Mermaid compatibility renderer.
 *
 * Mermaid keeps process-wide configuration, so renders are serialized. The
 * host owns sanitization and themes; canvases only provide source text.
 */
export function renderOfficialMermaid(
  source: string,
  theme: "dark" | "light"
): Promise<OfficialMermaidRenderResult> {
  const normalized = source.trim();
  if (!normalized) {
    return Promise.resolve({
      message: "Mermaid source is empty.",
      ok: false,
      reason: "empty",
    });
  }
  if (normalized.length > MAX_SOURCE_LENGTH) {
    return Promise.resolve({
      message: "Mermaid source is too large.",
      ok: false,
      reason: "too-large",
    });
  }

  const operation = renderQueue.then(
    () => performRender(normalized, theme),
    () => performRender(normalized, theme)
  );
  renderQueue = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}

export const officialMermaidRenderer = {
  render: renderOfficialMermaid,
};
