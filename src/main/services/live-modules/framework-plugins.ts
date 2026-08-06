import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import type * as esbuild from "esbuild";
import { scopedCssInjectorSnippet } from "./css-inject.ts";
import { requireProjectPackage } from "./package-resolve.ts";

function scopeId(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

/**
 * Framework-specific esbuild plugins.
 * Compilers load from the **project** (createRequire), not Pier host deps.
 * Injects `export function mount(el, host?)` so the files preview host can attach
 * and forward runtime errors.
 */
export function createFrameworkCompilePlugins(input: {
  entryAbsolutePath: string;
  entryDir: string;
  framework: LiveModuleFramework;
  moduleId: string;
  projectRoot: string | null;
}): esbuild.Plugin[] {
  if (!(input.projectRoot && input.framework !== "react")) {
    return [];
  }
  const projectRoot = input.projectRoot;
  const moduleId = input.moduleId;

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
              compileStyle: (opts: unknown) => {
                code: string;
                errors: Error[];
              };
              compileTemplate: (opts: unknown) => {
                code: string;
                errors: Array<string | Error>;
              };
              parse: (
                source: string,
                opts: { filename: string }
              ) => {
                descriptor: {
                  script?: { content: string; lang?: string } | null;
                  scriptSetup?: { content: string; lang?: string } | null;
                  styles: Array<{
                    content: string;
                    lang?: string;
                    scoped?: boolean;
                  }>;
                  template?: { content: string } | null;
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
            const hasScopedStyle = descriptor.styles.some((style) =>
              Boolean(style.scoped)
            );
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
                scoped: hasScopedStyle,
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

            // compileScript(genDefaultAs) does not attach __scopeId — same as
            // @vitejs/plugin-vue: without it, scoped CSS selectors never match
            // because the runtime never writes data-v-* on host elements.
            if (hasScopedStyle) {
              script += `\n__pier_sfc_main.__scopeId = ${JSON.stringify(scopeAttr)};\n`;
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
            if (styleText.trim().length > 0) {
              script += scopedCssInjectorSnippet(styleText, moduleId, id);
            }
            script += `
import { createApp as __pier_createApp } from "vue";
export default __pier_sfc_main;
export function mount(el, host) {
  const app = __pier_createApp(__pier_sfc_main);
  if (host && typeof host.onError === "function") {
    app.config.errorHandler = (err) => {
      host.onError(err instanceof Error ? err : new Error(String(err)));
    };
  }
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
              ) => { css?: { code: string }; js: { code: string } };
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
              // Prefer external CSS so we own injection + teardown tags.
              // Svelte 5: generate "client"; Svelte 4 may ignore unknown options.
              // dev:false avoids node:* HMR helpers the fence would reject.
              let jsCode: string;
              let cssCode = "";
              try {
                const compiled = compiler.compile(source, {
                  css: "external",
                  dev: false,
                  filename: args.path,
                  generate: "client",
                });
                jsCode = compiled.js.code;
                cssCode = compiled.css?.code ?? "";
              } catch {
                try {
                  const compiled = compiler.compile(source, {
                    css: false,
                    dev: false,
                    filename: args.path,
                    generate: "dom",
                  });
                  jsCode = compiled.js.code;
                  cssCode = compiled.css?.code ?? "";
                } catch {
                  // Last resort: injected CSS (no tagged teardown for that path).
                  jsCode = compiler.compile(source, {
                    css: "injected",
                    dev: false,
                    filename: args.path,
                    generate: "dom",
                  }).js.code;
                }
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
              const cssInject = scopedCssInjectorSnippet(
                cssCode,
                moduleId,
                scopeId(args.path)
              );
              const withMount = `${jsCode}
${cssInject}
import * as __pier_svelte from "svelte";
export function mount(el, host) {
  void host;
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

  if (input.framework === "solid") {
    const babel = requireProjectPackage<{
      transformSync: (
        code: string,
        opts: unknown
      ) => { code: string | null | undefined } | null;
    }>(projectRoot, "@babel/core");
    const solidPreset = requireProjectPackage(
      projectRoot,
      "babel-preset-solid"
    );
    const tsPreset = requireProjectPackage(
      projectRoot,
      "@babel/preset-typescript"
    );
    // babel-preset-solid transforms JSX but does not strip TypeScript; .canvas.solid.tsx
    // needs @babel/preset-typescript alongside it. Without it, fall back to esbuild.
    if (!(babel && solidPreset && tsPreset)) {
      return [];
    }
    const entryAbsolutePath = input.entryAbsolutePath;
    return [
      {
        name: "pier-live-solid",
        setup(build) {
          build.onLoad({ filter: /\.[jt]sx$/ }, (args) => {
            const source = readFileSync(args.path, "utf8");
            try {
              const presets: unknown[] = [
                [tsPreset],
                [solidPreset, { generate: "dom", hydratable: false }],
              ];
              const transformed = babel.transformSync(source, {
                babelrc: false,
                configFile: false,
                filename: args.path,
                presets,
                sourceMaps: false,
              });
              let code = transformed?.code ?? source;
              const isEntry = args.path === entryAbsolutePath;
              const hasMount =
                /\bexport\s+(?:async\s+)?function\s+mount\b/u.test(code) ||
                /\bexport\s+const\s+mount\s*=/u.test(code) ||
                /\bexport\s+\{\s*[^}]*\bmount\b/u.test(source);
              if (isEntry && !hasMount) {
                const defaultFn =
                  code.match(
                    /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/u
                  )?.[1] ??
                  code.match(
                    /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]*?\}\s*export\s+default\s+\1/u
                  )?.[1];
                if (!defaultFn) {
                  return {
                    errors: [
                      {
                        text: "Solid canvas must default-export a named function component or export function mount(el)",
                      },
                    ],
                  };
                }
                code += `
import { render as __pier_solid_render } from "solid-js/web";
export function mount(el, host) {
  void host;
  const dispose = __pier_solid_render(() => ${defaultFn}(), el);
  return () => {
    dispose();
    el.replaceChildren();
  };
}
`;
              }
              return {
                contents: code,
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
    // When the solid babel plugin transforms JSX, loader is "js" and this is unused.
    return {
      jsx: "automatic",
      jsxImportSource: "solid-js",
    };
  }
  return { jsx: "automatic" };
}
