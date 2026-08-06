import { createHash } from "node:crypto";

/**
 * Append a module-evaluation side-effect that injects CSS scoped to the canvas
 * shell (`[data-pier-canvas-shell]`) and tagged for teardown with
 * `data-pier-live-css="${moduleId}::${hash}"`.
 */
export function appendScopedCssInjector(
  jsSource: string,
  cssText: string,
  moduleId: string
): string {
  if (!cssText.trim()) {
    return jsSource;
  }
  const hash = createHash("sha256").update(cssText).digest("hex").slice(0, 8);
  const scoped = `@scope ([data-pier-canvas-shell]) {\n${cssText}\n}\n`;
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
