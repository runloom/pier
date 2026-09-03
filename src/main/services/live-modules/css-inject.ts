import { createHash } from "node:crypto";

/**
 * Append a module-evaluation side-effect that injects CSS scoped to the canvas
 * shell (`[data-pier-canvas-shell]`) and tagged for teardown with
 * `data-pier-live-css="${moduleId}::${hash}"`.
 *
 * `unscopedPropertyCss` is appended after the `@scope` block at the top level
 * of the injected stylesheet: `@property` registrations are invalid inside
 * grouping rules, so the Tailwind JIT hoists them here. The caller guarantees
 * it contains only `@property --tw-*` rules — never selector rules
 * (governance-locked by canvas-tailwind-source-governance).
 */
export function appendScopedCssInjector(
  jsSource: string,
  cssText: string,
  moduleId: string,
  unscopedPropertyCss = ""
): string {
  const scopedPart = cssText.trim()
    ? `@scope ([data-pier-canvas-shell]) {\n${cssText}\n}\n`
    : "";
  const propertyPart = unscopedPropertyCss.trim()
    ? `${unscopedPropertyCss.trim()}\n`
    : "";
  if (!(scopedPart || propertyPart)) {
    return jsSource;
  }
  const scoped = `${scopedPart}${propertyPart}`;
  const hash = createHash("sha256").update(scoped).digest("hex").slice(0, 8);
  const key = `${moduleId}::${hash}`;
  return `${jsSource}${cssInjectorIife(key, `${moduleId}::`, scoped)}`;
}

/**
 * Self-invoking injector shared by the module-level and framework (Vue/Svelte)
 * paths. Runs inside the disposable live-module realm, so styles must land in
 * the HOST document (`parent`) — the same document `css-cleanup.ts` removes
 * them from. Top-level evaluation (tests) falls back to its own document.
 */
function cssInjectorIife(key: string, prefix: string, css: string): string {
  return `
;(() => {
  let doc = document;
  try {
    if (globalThis.parent && globalThis.parent !== globalThis) doc = globalThis.parent.document;
  } catch {}
  const key = ${JSON.stringify(key)};
  const attr = "data-pier-live-css";
  const sel = 'style[' + attr + '="' + key + '"]';
  if (doc.head.querySelector(sel)) return;
  // Drop older hashes for the same moduleId prefix (hot-reload CSS changes).
  const prefix = ${JSON.stringify(prefix)};
  doc.head.querySelectorAll('style[' + attr + ']').forEach((node) => {
    const value = node.getAttribute(attr);
    if (value && value.startsWith(prefix) && value !== key) node.remove();
  });
  const s = doc.createElement("style");
  s.setAttribute(attr, key);
  s.textContent = ${JSON.stringify(css)};
  doc.head.appendChild(s);
})();
`;
}

/** Build the injector snippet for framework plugins (Vue/Svelte) using the same attr. */
export function scopedCssInjectorSnippet(
  cssText: string,
  moduleId: string,
  localId: string
): string {
  if (!cssText.trim()) {
    return "";
  }
  const hash = createHash("sha256")
    .update(`${localId}\0${cssText}`)
    .digest("hex")
    .slice(0, 8);
  const scoped = `@scope ([data-pier-canvas-shell]) {\n${cssText}\n}\n`;
  const key = `${moduleId}::${hash}`;
  return cssInjectorIife(key, `${moduleId}::`, scoped);
}

interface EsbuildOutputFileLike {
  contents: Uint8Array;
  path: string;
  text?: string;
}

function outputFileText(file: EsbuildOutputFileLike): string {
  return typeof file.text === "string"
    ? file.text
    : new TextDecoder().decode(file.contents);
}

/**
 * Split esbuild write:false outputs into the primary JS file, joined CSS, and
 * the external sourcemap (`sourcemap: "external"` emits `out.js.map`, which
 * esbuild may list BEFORE `out.js` — never let it be picked as the module).
 */
export function pickJsAndCssOutputs(
  outputFiles: readonly EsbuildOutputFileLike[]
): {
  cssText: string;
  jsFile: EsbuildOutputFileLike | undefined;
  sourceMapText: string | undefined;
} {
  let jsFile: EsbuildOutputFileLike | undefined;
  let sourceMapText: string | undefined;
  const cssChunks: string[] = [];
  for (const file of outputFiles) {
    const path = file.path.replaceAll("\\", "/");
    if (path.endsWith(".css")) {
      cssChunks.push(outputFileText(file));
      continue;
    }
    if (path.endsWith(".map")) {
      sourceMapText ??= outputFileText(file);
      continue;
    }
    if (!jsFile) {
      jsFile = file;
    }
  }
  return { cssText: cssChunks.join("\n"), jsFile, sourceMapText };
}
