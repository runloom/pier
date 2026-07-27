import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { LiveModuleDiagnostic } from "@shared/contracts/live-modules.ts";
import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import { isFrameworkBarePackage } from "@shared/live-module-framework.ts";
import {
  type LiveModuleRuntimeId,
  liveModuleRuntimeUrl,
} from "@shared/live-module-url.ts";
import {
  PIER_CANVAS_COMPONENT_EXPORT_NAMES,
  PIER_CANVAS_VALUE_EXPORT_NAMES,
} from "@shared/pier-canvas-export-names.ts";
// Type-only: erased at runtime. esbuild reads ESBUILD_BINARY_PATH once at
// module load and caches it (node_modules/esbuild/lib/main.js), so a static
// `import * as esbuild` would capture the env before we can set it. The value
// is loaded lazily below, AFTER ensureEsbuildBinaryPath() runs.
import type * as esbuild from "esbuild";
import { ensureEsbuildBinaryPath } from "./esbuild-binary.ts";
import {
  assertNotNodeModulesPath,
  assertPathInsideRoot,
  isDeniedBareSpecifier,
  LiveModuleFenceError,
} from "./fence.ts";
import {
  createFrameworkCompilePlugins,
  frameworkEsbuildJsx,
} from "./framework-plugins.ts";
import { resolveProjectPackage } from "./package-resolve.ts";
import {
  loadTsconfigPaths,
  mapSpecifierWithPaths,
  toProjectRelative,
  tryResolveFile,
} from "./resolve.ts";

export const LIVE_MODULE_COMPILE_TIMEOUT_MS = 15_000;
export const LIVE_MODULE_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const RUNTIME_BY_SPECIFIER: Record<string, LiveModuleRuntimeId> = {
  react: "react",
  "react-dom": "react-dom",
  "react-dom/client": "react-dom-client",
  "react/jsx-runtime": "jsx-runtime",
  "react/jsx-dev-runtime": "jsx-dev-runtime",
  // pier/canvas is NOT externalized to pier-live:// — see pierCanvasStubSource.
  // Bundling a globalThis stub keeps named exports in sync with renderer HMR
  // without requiring a main-process protocol restart.
};

const PIER_CANVAS_STUB_NAMESPACE = "pier-live-canvas-stub";
const PIER_CANVAS_STUB_PATH = "pier:canvas-stub";

const NODE_STUB_NAMESPACE = "pier-live-node-stub";

/**
 * No-op stub for `node:*` builtins referenced by non-React framework
 * internals (e.g. Svelte/Vue dev-mode or CJS-interop code paths that import
 * `createRequire` from `node:module`). These paths are dead in the browser
 * (guarded by environment checks); stubbing lets the bundle build without
 * resolving them. React canvases keep the strict compile-time deny.
 */
export function nodeBuiltinStubSource(specifier: string): string {
  if (specifier === "node:module") {
    return [
      "function createRequire() {",
      "  // Return a callable require whose result is also a deep no-op,",
      "  // so chained access (require('fs').readFileSync) never throws in",
      "  // the dead browser code paths that reference node:module.",
      "  return () => new Proxy({}, { get: () => () => undefined });",
      "}",
      "function isBuiltin() { return false; }",
      "const _default = { createRequire, isBuiltin };",
      "export { createRequire, isBuiltin };",
      "export default _default;",
    ].join("\n");
  }
  // Other node: builtins: a Proxy default returns a no-op for any property,
  // covering both named and default import patterns frameworks may emit.
  return ["export default new Proxy({}, { get: () => () => undefined });"].join(
    "\n"
  );
}

/**
 * Stub module inlined into each canvas bundle. Named exports always exist;
 * implementations are read from `globalThis.__PIER_LIVE_CANVAS__` at render time.
 *
 * Components become `createElement` wrappers. Value exports (hooks) are called
 * through with their own arguments and return value — wrapping those in
 * `createElement` would drop both. The wrapper keeps the `useX` name so React's
 * hook rules still apply at the canvas call site.
 */
export function pierCanvasStubSource(): string {
  const lines = [
    'import { createElement } from "react";',
    "function getCanvas() {",
    "  const canvas = globalThis.__PIER_LIVE_CANVAS__;",
    "  if (!canvas) {",
    '    throw new Error("Live module pier/canvas runtime missing — call installLiveModuleRuntime()");',
    "  }",
    "  return canvas;",
    "}",
  ];
  for (const name of PIER_CANVAS_COMPONENT_EXPORT_NAMES) {
    lines.push(
      `export function ${name}(props) {`,
      `  const Comp = getCanvas().${name};`,
      "  if (Comp == null) {",
      `    throw new Error("pier/canvas export missing: ${name}");`,
      "  }",
      "  return createElement(Comp, props);",
      "}"
    );
  }
  for (const name of PIER_CANVAS_VALUE_EXPORT_NAMES) {
    lines.push(
      `export function ${name}(...args) {`,
      `  const fn = getCanvas().${name};`,
      '  if (typeof fn !== "function") {',
      `    throw new Error("pier/canvas export missing: ${name}");`,
      "  }",
      "  return fn(...args);",
      "}"
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface CompileLiveModuleInput {
  allowNodeModules: boolean;
  contentRoot: string;
  entryAbsolutePath: string;
  forcePreviewBarrel: boolean;
  /** Detected from canvas file suffix; defaults to react. */
  framework: LiveModuleFramework;
  moduleId: string;
  previewBarrelAbsolutePath?: string | undefined;
  /** Project root for path mapping; null for home (no tsconfig paths). */
  projectRoot: string | null;
  tsconfigPaths: boolean;
}

export interface CompileLiveModuleSuccess {
  bytes: Uint8Array;
  graph: string[];
  ok: true;
}

export interface CompileLiveModuleFailure {
  diagnostics: LiveModuleDiagnostic[];
  ok: false;
}

export type CompileLiveModuleResult =
  | CompileLiveModuleSuccess
  | CompileLiveModuleFailure;

function diagnosticFromError(
  error: unknown,
  file?: string
): LiveModuleDiagnostic {
  if (error instanceof LiveModuleFenceError) {
    return {
      file,
      message: error.diagnosticMessage,
      severity: "error",
    };
  }
  return {
    file,
    message: error instanceof Error ? error.message : String(error),
    severity: "error",
  };
}

export async function compileLiveModule(
  input: CompileLiveModuleInput
): Promise<CompileLiveModuleResult> {
  // esbuild caches process.env.ESBUILD_BINARY_PATH into a module-level variable
  // the first time its module loads. Loading esbuild lazily here (after setting
  // the env) is what makes the packaged fix work — a static top-level import
  // would have already captured `undefined` at app startup.
  ensureEsbuildBinaryPath();
  const esbuild = await import("esbuild");
  const graph = new Set<string>();
  const fenceRoot = input.projectRoot ?? input.contentRoot;
  const entryDir = dirname(input.entryAbsolutePath);

  const resolvePlugin: esbuild.Plugin = {
    name: "pier-live-modules",
    setup(build) {
      if (input.framework === "react") {
        build.onResolve({ filter: /^pier\/canvas$/ }, () => ({
          namespace: PIER_CANVAS_STUB_NAMESPACE,
          path: PIER_CANVAS_STUB_PATH,
        }));
        build.onLoad(
          { filter: /.*/, namespace: PIER_CANVAS_STUB_NAMESPACE },
          () => ({
            contents: pierCanvasStubSource(),
            loader: "js",
            resolveDir: entryDir,
          })
        );
      }

      // Non-React frameworks bundle the project's framework + transitive deps.
      // Some internals reference `node:*` builtins in dead browser paths
      // (Svelte/Vue dev-mode, CJS interop). Stub them to no-ops instead of
      // failing the build; React keeps the strict compile-time deny.
      if (input.framework !== "react") {
        build.onResolve({ filter: /^node:/ }, (args) => ({
          namespace: NODE_STUB_NAMESPACE,
          path: args.path,
        }));
        build.onLoad(
          { filter: /.*/, namespace: NODE_STUB_NAMESPACE },
          (args) => ({
            contents: nodeBuiltinStubSource(args.path),
            loader: "js",
          })
        );
      }

      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") {
          return { path: args.path };
        }

        if (input.framework === "react") {
          const runtimeId = RUNTIME_BY_SPECIFIER[args.path];
          if (runtimeId) {
            return {
              external: true,
              path: liveModuleRuntimeUrl(runtimeId),
            };
          }
        }

        if (args.path.startsWith("pier-live://")) {
          return { external: true, path: args.path };
        }

        // Solid automatic JSX imports solid-js/jsx-runtime — resolve explicitly
        // with browser conditions (Node require picks SSR builds).
        if (
          input.framework === "solid" &&
          input.projectRoot &&
          (args.path === "solid-js/jsx-runtime" ||
            args.path === "solid-js/jsx-dev-runtime")
        ) {
          const resolvedJsx = resolveProjectPackage(
            args.resolveDir || args.importer || input.projectRoot,
            args.path
          );
          if (resolvedJsx) {
            return { path: resolvedJsx };
          }
        }

        if (args.path === "pier/canvas" && input.framework !== "react") {
          return {
            errors: [
              {
                text: "pier/canvas is React-only; use project components or the framework's UI kit",
              },
            ],
          };
        }

        if (
          isDeniedBareSpecifier(
            args.path,
            input.allowNodeModules,
            input.framework
          )
        ) {
          return {
            errors: [{ text: `denied import specifier: ${args.path}` }],
          };
        }

        if (isAbsolute(args.path)) {
          return {
            errors: [
              {
                text: `absolute import paths are not allowed: ${args.path}`,
              },
            ],
          };
        }

        let resolved: string | null = null;
        try {
          if (args.path.startsWith(".")) {
            const base = args.resolveDir || entryDir;
            resolved = tryResolveFile(normalize(join(base, args.path)));
          } else if (input.projectRoot && input.framework !== "react") {
            // Vue/Solid/Svelte + transitive deps. Resolve from importer so pnpm
            // nested packages (seroval under solid-js) are visible; browser
            // export conditions avoid SSR entries (solid server.cjs, svelte server).
            resolved = resolveProjectPackage(
              args.resolveDir || args.importer || input.projectRoot,
              args.path
            );
            if (!resolved && input.tsconfigPaths) {
              const config = loadTsconfigPaths(entryDir, input.projectRoot);
              if (config) {
                for (const candidate of mapSpecifierWithPaths(
                  args.path,
                  config
                )) {
                  resolved = tryResolveFile(candidate);
                  if (resolved) {
                    break;
                  }
                }
              }
            }
          } else if (input.tsconfigPaths && input.projectRoot) {
            const config = loadTsconfigPaths(entryDir, input.projectRoot);
            if (config) {
              for (const candidate of mapSpecifierWithPaths(
                args.path,
                config
              )) {
                resolved = tryResolveFile(candidate);
                if (resolved) {
                  break;
                }
              }
            }
          }
        } catch (error) {
          return {
            errors: [{ text: diagnosticFromError(error).message }],
          };
        }

        if (!resolved) {
          return {
            errors: [{ text: `unable to resolve import: ${args.path}` }],
          };
        }

        try {
          // Always realpath + project membership (blocks symlink escapes).
          // Non-React may import project node_modules; still must stay under projectRoot.
          const real = assertPathInsideRoot(
            resolved,
            input.projectRoot ?? fenceRoot,
            "import"
          );
          const isProjectPkg =
            input.framework !== "react" &&
            (isFrameworkBarePackage(args.path, input.framework) ||
              real.includes(`${sep}node_modules${sep}`) ||
              real.includes("/node_modules/"));
          assertNotNodeModulesPath(
            real,
            input.allowNodeModules,
            input.framework
          );
          // Watch project/source files only — not deep registry packages.
          if (!isProjectPkg) {
            if (input.projectRoot) {
              graph.add(toProjectRelative(real, input.projectRoot));
            } else {
              graph.add(toProjectRelative(real, input.contentRoot));
            }
          }

          if (input.forcePreviewBarrel && !isProjectPkg) {
            if (!input.previewBarrelAbsolutePath) {
              return {
                errors: [
                  {
                    text: "forcePreviewBarrel enabled but previewBarrel is missing",
                  },
                ],
              };
            }
            const barrelReal = assertPathInsideRoot(
              input.previewBarrelAbsolutePath,
              fenceRoot,
              "preview barrel"
            );
            const entryReal = assertPathInsideRoot(
              input.entryAbsolutePath,
              fenceRoot,
              "canvas"
            );
            let importerReal = entryReal;
            if (args.importer) {
              try {
                importerReal = assertPathInsideRoot(
                  args.importer,
                  fenceRoot,
                  "import"
                );
              } catch {
                importerReal = normalize(args.importer);
              }
            }
            if (importerReal === entryReal && real !== barrelReal) {
              return {
                errors: [
                  {
                    text: `forcePreviewBarrel: canvas may only import the preview barrel (got ${args.path})`,
                  },
                ],
              };
            }
          }

          return { path: real };
        } catch (error) {
          return {
            errors: [{ text: diagnosticFromError(error).message }],
          };
        }
      });
    },
  };

  const frameworkPlugins = createFrameworkCompilePlugins({
    entryDir,
    framework: input.framework,
    projectRoot: input.projectRoot,
  });
  const jsxOpts = frameworkEsbuildJsx(input.framework);

  try {
    const result = await esbuild.build({
      absWorkingDir: fenceRoot,
      bundle: true,
      entryPoints: [input.entryAbsolutePath],
      format: "esm",
      ...jsxOpts,
      logLevel: "silent",
      outfile: "out.js",
      platform: "browser",
      plugins: [...frameworkPlugins, resolvePlugin],
      target: ["chrome120"],
      write: false,
    });

    const output = result.outputFiles?.[0];
    if (!output) {
      return {
        diagnostics: [
          {
            message: "esbuild produced no output",
            severity: "error",
          },
        ],
        ok: false,
      };
    }
    if (output.contents.byteLength > LIVE_MODULE_MAX_OUTPUT_BYTES) {
      return {
        diagnostics: [
          {
            message: `compile output exceeds ${LIVE_MODULE_MAX_OUTPUT_BYTES} bytes`,
            severity: "error",
          },
        ],
        ok: false,
      };
    }

    if (input.projectRoot) {
      graph.add(toProjectRelative(input.entryAbsolutePath, input.projectRoot));
    } else {
      graph.add(toProjectRelative(input.entryAbsolutePath, input.contentRoot));
    }

    return {
      bytes: output.contents,
      graph: [...graph].sort(),
      ok: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      diagnostics: [
        {
          file: input.entryAbsolutePath,
          message,
          severity: "error",
        },
      ],
      ok: false,
    };
  }
}
