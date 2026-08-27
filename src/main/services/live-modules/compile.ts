import { dirname } from "node:path";
import type { LiveModuleDiagnostic } from "@shared/contracts/live-modules.ts";
import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import type { BuildOptions } from "esbuild";
import { type CompiledLiveAsset, createCanvasAssetPlugin } from "./assets.ts";
import {
  type CompileContextEntry,
  type CompileContextRefs,
  disposeCompileContextIfCurrent,
  esbuildContextKey,
  getCompileContextEntry,
  recoverEsbuildService,
} from "./compile-context-cache.ts";
import { createLiveModuleResolvePlugin } from "./compile-resolve-plugin.ts";
import { appendScopedCssInjector, pickJsAndCssOutputs } from "./css-inject.ts";
import {
  compileFailureResult,
  diagnosticFromEsbuildMessage,
  diagnosticsFromBuildFailure,
} from "./diagnostics.ts";
import {
  ESBUILD_SERVICE_CLOSED_USER_MESSAGE,
  isEsbuildServiceClosedError,
} from "./esbuild-binary.ts";
import {
  createFrameworkCompilePlugins,
  frameworkEsbuildJsx,
} from "./framework-plugins.ts";
import {
  loadTsconfigPaths,
  type TsconfigPathsConfig,
  toProjectRelative,
} from "./resolve.ts";
import {
  buildCanvasTailwindCss,
  entryDirectImportsFromMetafile,
} from "./tailwind.ts";

export const LIVE_MODULE_COMPILE_TIMEOUT_MS = 15_000;
/** Raised to fit inline sourcemaps; still a hard abuse cap on ticket buffers. */
export const LIVE_MODULE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface CompileLiveModuleInput {
  allowedBarePackages: readonly string[];
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
  /** Root id — context cache scoping + per-root disposal. */
  rootId: string;
  tsconfigPaths: boolean;
}

export interface CompileLiveModuleSuccess {
  assets: CompiledLiveAsset[];
  bytes: Uint8Array;
  graph: string[];
  ok: true;
  warnings?: LiveModuleDiagnostic[] | undefined;
}

export interface CompileLiveModuleFailure {
  diagnostics: LiveModuleDiagnostic[];
  /** Relative paths resolved before failure (at least the entry). */
  graph?: string[];
  ok: false;
}

export type CompileLiveModuleResult =
  | CompileLiveModuleSuccess
  | CompileLiveModuleFailure;

function addEntryToGraph(
  graphRef: { current: Set<string> },
  entryAbsolutePath: string,
  projectRoot: string | null,
  contentRoot: string
): void {
  const g = graphRef.current;
  g.add(
    projectRoot
      ? toProjectRelative(entryAbsolutePath, projectRoot)
      : toProjectRelative(entryAbsolutePath, contentRoot)
  );
}

export async function compileLiveModule(
  input: CompileLiveModuleInput
): Promise<CompileLiveModuleResult> {
  const fenceRoot = input.projectRoot ?? input.contentRoot;
  const entryDir = dirname(input.entryAbsolutePath);

  const contextKey = esbuildContextKey({
    allowNodeModules: input.allowNodeModules,
    allowedBarePackages: input.allowedBarePackages,
    contentRoot: input.contentRoot,
    entryAbsolutePath: input.entryAbsolutePath,
    forcePreviewBarrel: input.forcePreviewBarrel,
    framework: input.framework,
    previewBarrelAbsolutePath: input.previewBarrelAbsolutePath,
    projectRoot: input.projectRoot,
    rootId: input.rootId,
    tsconfigPaths: input.tsconfigPaths,
  });

  const frameworkPlugins = createFrameworkCompilePlugins({
    entryAbsolutePath: input.entryAbsolutePath,
    entryDir,
    framework: input.framework,
    moduleId: input.moduleId,
    projectRoot: input.projectRoot,
  });
  const jsxOpts = frameworkEsbuildJsx(input.framework);

  const createOptions = ({
    assetsRef,
    graphRef,
  }: CompileContextRefs): BuildOptions => {
    let tsconfigMemo: TsconfigPathsConfig | null | undefined;
    const getTsconfig = (): TsconfigPathsConfig | null => {
      if (tsconfigMemo !== undefined) {
        return tsconfigMemo;
      }
      tsconfigMemo =
        input.tsconfigPaths && input.projectRoot
          ? loadTsconfigPaths(entryDir, input.projectRoot)
          : null;
      return tsconfigMemo;
    };

    return {
      absWorkingDir: fenceRoot,
      bundle: true,
      entryPoints: [input.entryAbsolutePath],
      format: "esm",
      ...jsxOpts,
      logLevel: "silent",
      metafile: true,
      outfile: "out.js",
      platform: "browser",
      plugins: [
        ...frameworkPlugins,
        createLiveModuleResolvePlugin({
          allowNodeModules: input.allowNodeModules,
          allowedBarePackages: input.allowedBarePackages,
          contentRoot: input.contentRoot,
          entryAbsolutePath: input.entryAbsolutePath,
          entryDir,
          fenceRoot,
          forcePreviewBarrel: input.forcePreviewBarrel,
          framework: input.framework,
          getTsconfig,
          graphRef,
          previewBarrelAbsolutePath: input.previewBarrelAbsolutePath,
          projectRoot: input.projectRoot,
        }),
        createCanvasAssetPlugin({ assetsRef, fenceRoot }),
      ],
      sourcemap: "inline",
      target: ["chrome120"],
      write: false,
    };
  };

  // Incremental reuse is safe: onLoad always re-reads canvas sources from
  // disk, and the failure path below drops the context, so a failed graph is
  // never reused. Do not dispose unconditionally here — that would turn every
  // compile into a full re-bundle.
  // Plugin closures capture the entry's graphRef (and this first-call input).
  // The cache key includes every compile option, so a spec.resolve change
  // creates a fresh context instead of reusing stale closures.
  let recoveredService = false;
  for (;;) {
    let entry: CompileContextEntry;
    try {
      entry = await getCompileContextEntry(contextKey, createOptions);
    } catch (error) {
      if (!recoveredService && isEsbuildServiceClosedError(error)) {
        recoveredService = true;
        await recoverEsbuildService();
        continue;
      }
      let errorMessage = isEsbuildServiceClosedError(error)
        ? ESBUILD_SERVICE_CLOSED_USER_MESSAGE
        : null;
      if (!errorMessage) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      return compileFailureResult(
        [
          {
            message: errorMessage,
            severity: "error",
          },
        ],
        new Set(),
        input.entryAbsolutePath,
        input.projectRoot,
        input.contentRoot
      );
    }

    try {
      // Reset the dependency graph and asset list before each rebuild — the SAME
      // objects the cached plugin closures captured, not per-call ones.
      entry.graphRef.current = new Set<string>();
      entry.assetsRef.current = [];
      const result = await entry.context.rebuild();

      const { cssText, jsFile } = pickJsAndCssOutputs(result.outputFiles ?? []);
      if (!jsFile) {
        return compileFailureResult(
          [
            {
              message: "esbuild produced no output",
              severity: "error",
            },
          ],
          entry.graphRef.current,
          input.entryAbsolutePath,
          input.projectRoot,
          input.contentRoot
        );
      }

      const jsText =
        typeof jsFile.text === "string"
          ? jsFile.text
          : new TextDecoder().decode(jsFile.contents);

      // Runtime Tailwind JIT over the entry + dependency graph sources; merged
      // into the same scoped injector so utilities tear down with the module.
      const tailwind = await buildCanvasTailwindCss({
        cacheSlot: entry.tailwindCache,
        entryAbsolutePath: input.entryAbsolutePath,
        entryDirectImports: entryDirectImportsFromMetafile(
          result.metafile,
          fenceRoot,
          input.entryAbsolutePath
        ),
        fenceRoot,
        graphRelativePaths: entry.graphRef.current,
      });
      const mergedCss = [cssText, tailwind.css]
        .filter((part) => part.trim().length > 0)
        .join("\n");
      const finalSource = appendScopedCssInjector(
        jsText,
        mergedCss,
        input.moduleId,
        tailwind.propertyCss
      );
      const bytes = new TextEncoder().encode(finalSource);

      if (bytes.byteLength > LIVE_MODULE_MAX_OUTPUT_BYTES) {
        return compileFailureResult(
          [
            {
              message: `compile output exceeds ${LIVE_MODULE_MAX_OUTPUT_BYTES} bytes`,
              severity: "error",
            },
          ],
          entry.graphRef.current,
          input.entryAbsolutePath,
          input.projectRoot,
          input.contentRoot
        );
      }

      addEntryToGraph(
        entry.graphRef,
        input.entryAbsolutePath,
        input.projectRoot,
        input.contentRoot
      );

      const warningDiagnostics = [
        ...(result.warnings ?? []).map((msg) =>
          diagnosticFromEsbuildMessage(msg, "warning")
        ),
        ...tailwind.diagnostics,
      ];

      const success: CompileLiveModuleSuccess = {
        assets: [...entry.assetsRef.current],
        bytes,
        graph: [...entry.graphRef.current].sort(),
        ok: true,
      };
      if (warningDiagnostics.length > 0) {
        success.warnings = warningDiagnostics;
      }
      return success;
    } catch (error) {
      // Drop the cached context so the next reload re-reads files and the stub.
      // Incremental reuse after a missing-export failure can keep the old graph.
      // Identity-checked: a timed-out compile must not dispose the successor
      // context a user retry has already created under the same key.
      await disposeCompileContextIfCurrent(contextKey, entry);
      if (!recoveredService && isEsbuildServiceClosedError(error)) {
        recoveredService = true;
        await recoverEsbuildService();
        continue;
      }
      return compileFailureResult(
        isEsbuildServiceClosedError(error)
          ? [
              {
                message: ESBUILD_SERVICE_CLOSED_USER_MESSAGE,
                severity: "error",
              },
            ]
          : diagnosticsFromBuildFailure(error),
        entry.graphRef.current,
        input.entryAbsolutePath,
        input.projectRoot,
        input.contentRoot
      );
    }
  }
}
