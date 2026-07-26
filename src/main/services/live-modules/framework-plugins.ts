import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import type * as esbuild from "esbuild";
import { requireProjectPackage } from "./package-resolve.ts";

function scopeId(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

/**
 * Framework-specific esbuild plugins.
 * Compilers load from the **project** (createRequire), not Pier host deps.
 * Injects `export function mount(el)` so the files preview host can always attach.
 */
export function createFrameworkCompilePlugins(input: {
  entryDir: string;
  framework: LiveModuleFramework;
  projectRoot: string | null;
}): esbuild.Plugin[] {
  if (!(input.projectRoot && input.framework !== "react")) {
    return [];
  }
  const projectRoot = input.projectRoot;

  if (input.framework === "vue") {
    return [
      {
        name: "pier-live-vue-sfc",
        setup(build) {
          build.onLoad({ filter: /\.vue$/ }, (args) => {
            const compiler = requireProjectPackage<{
              compileScript: (
                descriptor: unknown,
                opts: unknown
              ) => { content: string };
              compileStyle: (opts: {
                filename: string;
                id: string;
                scoped?: boolean;
                source: string;
              }) => { code: string; errors: Error[] };
              compileTemplate: (opts: unknown) => {
                code: string;
                errors: Error[];
              };
              parse: (
                source: string,
                opts?: unknown
              ) => {
                descriptor: {
                  script: { content: string; lang?: string } | null;
                  scriptSetup: { content: string; lang?: string } | null;
                  template: { content: string } | null;
                  styles: Array<{
                    content: string;
                    lang?: string;
                    scoped?: boolean;
                  }>;
                };
                errors: Error[];
              };
            }>(projectRoot, "@vue/compiler-sfc");
            if (!compiler) {
              return {
                errors: [
                  {
                    text: "Vue canvas requires vue + @vue/compiler-sfc in the project (pnpm add vue && pnpm add -D @vue/compiler-sfc)",
                  },
                ],
              };
            }
            const source = readFileSync(args.path, "utf8");
            const id = scopeId(args.path);
            const scopeAttr = `data-v-${id}`;
            const { descriptor, errors } = compiler.parse(source, {
              filename: args.path,
            });
            if (errors.length > 0) {
              return {
                errors: errors.map((error) => ({ text: String(error) })),
              };
            }
            let script: string;
            if (descriptor.scriptSetup || descriptor.script) {
              const compiled = compiler.compileScript(descriptor, {
                genDefaultAs: "__pier_sfc_main",
                id,
                inlineTemplate: true,
              });
              script = compiled.content;
            } else if (descriptor.template) {
              const template = compiler.compileTemplate({
                filename: args.path,
                id,
                source: descriptor.template.content,
              });
              if (template.errors.length > 0) {
                return {
                  errors: template.errors.map((error) => ({
                    text: String(error),
                  })),
                };
              }
              script = `${template.code}\nconst __pier_sfc_main = { render };\n`;
            } else {
              return {
                errors: [{ text: "Vue SFC has no script or template" }],
              };
            }

            const styleChunks: string[] = [];
            for (const style of descriptor.styles) {
              const lang = style.lang?.toLowerCase();
              if (lang && lang !== "css") {
                return {
                  errors: [
                    {
                      text: `Vue canvas styles support plain CSS only (got lang="${style.lang}"). Preprocessors are not compiled.`,
                    },
                  ],
                };
              }
              const compiledStyle = compiler.compileStyle({
                filename: args.path,
                id: scopeAttr,
                scoped: Boolean(style.scoped),
                source: style.content,
              });
              if (compiledStyle.errors.length > 0) {
                return {
                  errors: compiledStyle.errors.map((error) => ({
                    text: String(error),
                  })),
                };
              }
              if (compiledStyle.code.trim().length > 0) {
                styleChunks.push(compiledStyle.code);
              }
            }
            const styleText = styleChunks.join("\n");
            // Content-hash so remount with changed CSS replaces the tag.
            const styleHash = createHash("sha256")
              .update(styleText)
              .digest("hex")
              .slice(0, 8);
            if (styleText.trim().length > 0) {
              // Module evaluation side-effect so nested SFCs get styles even when
              // only the entry calls mount() (Vite-style CSS inject).
              script += `
;(() => {
  const key = ${JSON.stringify(`${id}:${styleHash}`)};
  const sel = 'style[data-pier-live-vue="' + key + '"]';
  if (document.head.querySelector(sel)) return;
  document.head.querySelectorAll('style[data-pier-live-vue^="${id}:"]').forEach((n) => n.remove());
  const s = document.createElement("style");
  s.setAttribute("data-pier-live-vue", key);
  s.textContent = ${JSON.stringify(styleText)};
  document.head.appendChild(s);
})();
`;
            }
            script += `
import { createApp as __pier_createApp } from "vue";
export default __pier_sfc_main;
export function mount(el) {
  const app = __pier_createApp(__pier_sfc_main);
  app.mount(el);
  return () => {
    app.unmount();
  };
}
`;
            const scriptLang = (
              descriptor.scriptSetup?.lang ??
              descriptor.script?.lang ??
              "js"
            ).toLowerCase();
            const loader: esbuild.Loader =
              scriptLang === "ts" || scriptLang === "tsx" ? "ts" : "js";
            return {
              contents: script,
              loader,
              // Resolve relative imports from this SFC, not the canvas entry.
              resolveDir: dirname(args.path),
            };
          });
        },
      },
    ];
  }

  if (input.framework === "svelte") {
    return [
      {
        name: "pier-live-svelte",
        setup(build) {
          build.onLoad({ filter: /\.svelte$/ }, (args) => {
            const compiler = requireProjectPackage<{
              compile: (
                source: string,
                opts: unknown
              ) => { js: { code: string } };
            }>(projectRoot, "svelte/compiler");
            if (!compiler) {
              return {
                errors: [
                  {
                    text: "Svelte canvas requires svelte in the project (pnpm add -D svelte)",
                  },
                ],
              };
            }
            const source = readFileSync(args.path, "utf8");
            try {
              // Svelte 5: generate "client"; Svelte 4 may ignore unknown options.
              let jsCode: string;
              try {
                jsCode = compiler.compile(source, {
                  css: "injected",
                  filename: args.path,
                  generate: "client",
                }).js.code;
              } catch {
                jsCode = compiler.compile(source, {
                  css: "injected",
                  filename: args.path,
                  generate: "dom",
                }).js.code;
              }
              // Svelte 5: `export default function Name($$anchor)`
              // Svelte 4: `export default Name` (class-like)
              const defaultMatch =
                jsCode.match(
                  /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/u
                ) ?? jsCode.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;/u);
              const compName = defaultMatch?.[1];
              if (!compName) {
                return {
                  errors: [
                    {
                      text: "Svelte compile did not produce a default export name; add export function mount(el) in a wrapper",
                    },
                  ],
                };
              }
              const withMount = `${jsCode}
import * as __pier_svelte from "svelte";
export function mount(el) {
  if (typeof __pier_svelte.mount === "function") {
    const app = __pier_svelte.mount(${compName}, { target: el });
    return () => {
      if (typeof __pier_svelte.unmount === "function") {
        __pier_svelte.unmount(app);
      }
    };
  }
  const app = new ${compName}({ target: el });
  return () => {
    if (typeof app.$destroy === "function") app.$destroy();
  };
}
`;
              return {
                contents: withMount,
                loader: "js",
                resolveDir: dirname(args.path),
              };
            } catch (error) {
              return {
                errors: [
                  {
                    text:
                      error instanceof Error ? error.message : String(error),
                  },
                ],
              };
            }
          });
        },
      },
    ];
  }

  return [];
}

export function frameworkEsbuildJsx(
  framework: LiveModuleFramework
): Pick<esbuild.BuildOptions, "jsx" | "jsxImportSource" | "jsxDev"> {
  if (framework === "solid") {
    // solid-js ships jsx-runtime under solid-js/jsx-runtime (not solid-js root).
    return {
      jsx: "automatic",
      jsxImportSource: "solid-js",
    };
  }
  return { jsx: "automatic" };
}
