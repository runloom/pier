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
  const injector = `
;(() => {
  const key = ${JSON.stringify(key)};
  const attr = "data-pier-live-css";
  const sel = 'style[' + attr + '="' + key + '"]';
  if (document.head.querySelector(sel)) return;
  // Drop older hashes for the same moduleId prefix.
  const prefix = ${JSON.stringify(`${moduleId}::`)};
  document.head.querySelectorAll('style[' + attr + ']').forEach((node) => {
    const value = node.getAttribute(attr);
    if (value && value.startsWith(prefix) && value !== key) node.remove();
  });
  const s = document.createElement("style");
  s.setAttribute(attr, key);
  s.textContent = ${JSON.stringify(scoped)};
  document.head.appendChild(s);
})();
`;
  return `${jsSource}${injector}`;
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
  return `
;(() => {
  const key = ${JSON.stringify(key)};
  const attr = "data-pier-live-css";
  const sel = 'style[' + attr + '="' + key + '"]';
  if (document.head.querySelector(sel)) return;
  // Drop older hashes for the same moduleId prefix (hot-reload CSS changes).
  const prefix = ${JSON.stringify(`${moduleId}::`)};
  document.head.querySelectorAll('style[' + attr + ']').forEach((node) => {
    const value = node.getAttribute(attr);
    if (value && value.startsWith(prefix) && value !== key) node.remove();
  });
  const s = document.createElement("style");
  s.setAttribute(attr, key);
  s.textContent = ${JSON.stringify(scoped)};
  document.head.appendChild(s);
})();
`;
}

/** Split esbuild write:false outputs into the primary JS file and joined CSS. */
export function pickJsAndCssOutputs(
  outputFiles: readonly {
    contents: Uint8Array;
    path: string;
    text?: string;
  }[]
): {
  cssText: string;
  jsFile:
    | {
        contents: Uint8Array;
        path: string;
        text?: string;
      }
    | undefined;
} {
  let jsFile:
    | {
        contents: Uint8Array;
        path: string;
        text?: string;
      }
    | undefined;
  const cssChunks: string[] = [];
  for (const file of outputFiles) {
    const path = file.path.replaceAll("\\", "/");
    if (path.endsWith(".css")) {
      cssChunks.push(
        typeof file.text === "string"
          ? file.text
          : new TextDecoder().decode(file.contents)
      );
      continue;
    }
    if (!jsFile) {
      jsFile = file;
    }
  }
  return { cssText: cssChunks.join("\n"), jsFile };
}
