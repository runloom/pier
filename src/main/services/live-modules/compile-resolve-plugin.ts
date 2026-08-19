import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import { isFrameworkBarePackage } from "@shared/live-module-framework.ts";
import {
  type LiveModuleRuntimeId,
  liveModuleRuntimeUrl,
} from "@shared/live-module-url.ts";
import type * as esbuild from "esbuild";
import { diagnosticFromError } from "./diagnostics.ts";
import {
  assertNotNodeModulesPath,
  assertPathInsideRoot,
  isDeniedBareSpecifier,
  isPathWithinRoot,
} from "./fence.ts";
import { registerHostStub } from "./host-stub.ts";
import { resolveProjectPackage } from "./package-resolve.ts";
import {
  mapSpecifierWithPaths,
  type TsconfigPathsConfig,
  toProjectRelative,
  tryResolveFile,
} from "./resolve.ts";
import {
  NODE_STUB_NAMESPACE,
  nodeBuiltinStubSource,
  PIER_CANVAS_STUB_NAMESPACE,
  PIER_CANVAS_STUB_PATH,
  pierCanvasStubSource,
} from "./stub-sources.ts";

const RUNTIME_BY_SPECIFIER: Record<string, LiveModuleRuntimeId> = {
  react: "react",
  "react-dom": "react-dom",
  "react-dom/client": "react-dom-client",
  "react/jsx-runtime": "jsx-runtime",
  "react/jsx-dev-runtime": "jsx-dev-runtime",
  // pier/canvas is NOT externalized to pier-live:// — see pierCanvasStubSource.
};

/**
 * True when the importer is a framework internal (resolved under
 * node_modules) rather than canvas/project source. Canvas source lives under
 * contentRoot, so a path under contentRoot with a node_modules segment is a
 * spoofed directory name, not a framework internal.
 */
function importerInNodeModules(
  importer: string | undefined,
  contentRoot: string
): boolean {
  if (!importer) {
    return false;
  }
  const hasNodeModules =
    importer.includes(`${sep}node_modules${sep}`) ||
    importer.includes("/node_modules/");
  if (!hasNodeModules) {
    return false;
  }
  return !importer.startsWith(contentRoot);
}

export interface ResolvePluginContext {
  allowNodeModules: boolean;
  contentRoot: string;
  entryAbsolutePath: string;
  /** dirname(entryAbsolutePath). */
  entryDir: string;
  /** projectRoot ?? contentRoot. */
  fenceRoot: string;
  forcePreviewBarrel: boolean;
  framework: LiveModuleFramework;
  /** Memoized tsconfig loader (called with entryDir + projectRoot). */
  getTsconfig: () => TsconfigPathsConfig | null;
  graphRef: { current: Set<string> };
  previewBarrelAbsolutePath?: string | undefined;
  projectRoot: string | null;
}

function canvasSourceLoader(filePath: string): esbuild.Loader {
  if (filePath.endsWith(".tsx")) {
    return "tsx";
  }
  if (filePath.endsWith(".ts")) {
    return "ts";
  }
  if (filePath.endsWith(".jsx")) {
    return "jsx";
  }
  return "js";
}

function addToGraph(
  graphRef: { current: Set<string> },
  realPath: string,
  projectRoot: string | null,
  contentRoot: string
): void {
  const g = graphRef.current;
  g.add(
    projectRoot
      ? toProjectRelative(realPath, projectRoot)
      : toProjectRelative(realPath, contentRoot)
  );
}

/**
 * The pier-live resolve plugin: fence + path resolution + stub namespaces.
 * Created once per cached esbuild context; closures capture the context's
 * graphRef and first-call input (the cache key includes every option).
 */
export function createLiveModuleResolvePlugin(
  ctx: ResolvePluginContext
): esbuild.Plugin {
  return {
    name: "pier-live-modules",
    setup(build) {
      if (ctx.framework === "react") {
        registerHostStub(build);
        build.onResolve({ filter: /^pier\/canvas$/ }, () => ({
          namespace: PIER_CANVAS_STUB_NAMESPACE,
          path: PIER_CANVAS_STUB_PATH,
        }));
        build.onLoad(
          { filter: /.*/, namespace: PIER_CANVAS_STUB_NAMESPACE },
          () => ({
            contents: pierCanvasStubSource(),
            loader: "js",
            resolveDir: ctx.entryDir,
          })
        );
        // Always read canvas sources from disk. esbuild's incremental context
        // otherwise keeps the previous parse after a missing-export failure.
        build.onLoad(
          { filter: /\.[cm]?[jt]sx?$/, namespace: "file" },
          (args) => {
            if (
              !(
                isPathWithinRoot(args.path, ctx.contentRoot) ||
                isPathWithinRoot(args.path, ctx.fenceRoot)
              )
            ) {
              return;
            }
            return {
              contents: readFileSync(args.path, "utf8"),
              loader: canvasSourceLoader(args.path),
              watchFiles: [args.path],
            };
          }
        );
      }

      // Non-React: stub node:* only when the importer is a framework
      // internal under node_modules. Canvas source importing node:* fails.
      if (ctx.framework !== "react") {
        build.onResolve({ filter: /^node:/ }, (args) => {
          if (!importerInNodeModules(args.importer, ctx.contentRoot)) {
            return {
              errors: [{ text: `denied node builtin import: ${args.path}` }],
            };
          }
          return {
            namespace: NODE_STUB_NAMESPACE,
            path: args.path,
          };
        });
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

        if (ctx.framework === "react") {
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

        // Solid automatic JSX imports solid-js/jsx-runtime — resolve
        // explicitly with browser conditions (Node require picks SSR).
        if (
          ctx.framework === "solid" &&
          ctx.projectRoot &&
          (args.path === "solid-js/jsx-runtime" ||
            args.path === "solid-js/jsx-dev-runtime")
        ) {
          const resolvedJsx = resolveProjectPackage(
            args.resolveDir || args.importer || ctx.projectRoot,
            args.path
          );
          if (resolvedJsx) {
            return { path: resolvedJsx };
          }
        }

        if (args.path === "pier/canvas" && ctx.framework !== "react") {
          return {
            errors: [
              {
                text: "pier/canvas is React-only; use project components or the framework's UI kit",
              },
            ],
          };
        }
        if (args.path === "pier/host" && ctx.framework !== "react") {
          return {
            errors: [
              {
                text: "pier/host is React-only; bind Host API from a React canvas",
              },
            ],
          };
        }

        const deniedBare = isDeniedBareSpecifier(
          args.path,
          ctx.allowNodeModules,
          ctx.framework
        );
        // Transitive deps inside node_modules may bare-import packages
        // outside the framework allowlist; canvas/project source may not.
        if (
          deniedBare &&
          !importerInNodeModules(args.importer, ctx.contentRoot)
        ) {
          return {
            errors: [{ text: `denied import specifier: ${args.path}` }],
          };
        }

        if (isAbsolute(args.path)) {
          return {
            errors: [
              { text: `absolute import paths are not allowed: ${args.path}` },
            ],
          };
        }

        let resolved: string | null = null;
        try {
          if (args.path.startsWith(".")) {
            const base = args.resolveDir || ctx.entryDir;
            resolved = tryResolveFile(normalize(join(base, args.path)));
          } else if (ctx.projectRoot && ctx.framework !== "react") {
            // Vue/Solid/Svelte + transitive deps. Resolve from importer so
            // pnpm nested packages are visible; browser export conditions
            // avoid SSR entries.
            resolved = resolveProjectPackage(
              args.resolveDir || args.importer || ctx.projectRoot,
              args.path
            );
            if (!resolved) {
              const config = ctx.getTsconfig();
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
          } else if (ctx.projectRoot) {
            const config = ctx.getTsconfig();
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
            // allowNodeModules:true must actually resolve bare packages.
            if (!resolved && ctx.allowNodeModules) {
              resolved = resolveProjectPackage(
                args.resolveDir || ctx.entryDir,
                args.path
              );
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
          const real = assertPathInsideRoot(
            resolved,
            ctx.projectRoot ?? ctx.fenceRoot,
            "import"
          );
          const isProjectPkg =
            ctx.framework !== "react" &&
            (isFrameworkBarePackage(args.path, ctx.framework) ||
              real.includes(`${sep}node_modules${sep}`) ||
              real.includes("/node_modules/"));
          assertNotNodeModulesPath(real, ctx.allowNodeModules, ctx.framework);
          // Watch project/source files only — not deep registry packages.
          if (!isProjectPkg) {
            addToGraph(ctx.graphRef, real, ctx.projectRoot, ctx.contentRoot);
          }

          if (ctx.forcePreviewBarrel && !isProjectPkg) {
            if (!ctx.previewBarrelAbsolutePath) {
              return {
                errors: [
                  {
                    text: "forcePreviewBarrel enabled but previewBarrel is missing",
                  },
                ],
              };
            }
            const barrelReal = assertPathInsideRoot(
              ctx.previewBarrelAbsolutePath,
              ctx.fenceRoot,
              "preview barrel"
            );
            const entryReal = assertPathInsideRoot(
              ctx.entryAbsolutePath,
              ctx.fenceRoot,
              "canvas"
            );
            let importerReal = entryReal;
            if (args.importer) {
              try {
                importerReal = assertPathInsideRoot(
                  args.importer,
                  ctx.fenceRoot,
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
}
