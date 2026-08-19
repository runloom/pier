import { dirname } from "node:path";
import type { LiveModuleDiagnostic } from "@shared/contracts/live-modules.ts";
import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import {
  type CompileContextEntry,
  disposeCompileContextIfCurrent,
  esbuildContextKey,
  getCompileContextEntry,
} from "./compile-context-cache.ts";
import { createLiveModuleResolvePlugin } from "./compile-resolve-plugin.ts";
import { appendScopedCssInjector, pickJsAndCssOutputs } from "./css-inject.ts";
import {
  compileFailureResult,
  diagnosticFromEsbuildMessage,
  diagnosticsFromBuildFailure,
} from "./diagnostics.ts";
import {
  createFrameworkCompilePlugins,
  frameworkEsbuildJsx,
} from "./framework-plugins.ts";
import {
  loadTsconfigPaths,
  type TsconfigPathsConfig,
  toProjectRelative,
} from "./resolve.ts";

export const LIVE_MODULE_COMPILE_TIMEOUT_MS = 15_000;
/** Raised to fit inline sourcemaps; still a hard abuse cap on ticket buffers. */
export const LIVE_MODULE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

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
  /** Root id — context cache scoping + per-root disposal. */
  rootId: string;
  tsconfigPaths: boolean;
}

export interface CompileLiveModuleSuccess {
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

  // Incremental reuse is safe: onLoad always re-reads canvas sources from
  // disk, and the failure path below drops the context, so a failed graph is
  // never reused. Do not dispose unconditionally here — that would turn every
  // compile into a full re-bundle.
  // Plugin closures capture the entry's graphRef (and this first-call input).
  // The cache key includes every compile option, so a spec.resolve change
  // creates a fresh context instead of reusing stale closures.
  const entry: CompileContextEntry = await getCompileContextEntry(
    contextKey,
    (graphRef) => {
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
        outfile: "out.js",
        platform: "browser",
        plugins: [
          ...frameworkPlugins,
          createLiveModuleResolvePlugin({
            allowNodeModules: input.allowNodeModules,
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
        ],
        sourcemap: "inline",
        target: ["chrome120"],
        write: false,
      };
    }
  );

  try {
    // Reset the dependency graph before each rebuild — the SAME object the
    // cached plugin closures captured (entry.graphRef), not a per-call one.
    entry.graphRef.current = new Set<string>();
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
    const finalSource = appendScopedCssInjector(
      jsText,
      cssText,
      input.moduleId
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

    const warningDiagnostics = (result.warnings ?? []).map((msg) =>
      diagnosticFromEsbuildMessage(msg, "warning")
    );

    const success: CompileLiveModuleSuccess = {
      bytes,
      graph: [...entry.graphRef.current].sort(),
      ok: true,
    };
    if (warningDiagnostics.length > 0) {
      success.warnings = warningDiagnostics;
    }
    return success;
  } catch (error) {
    const failure = compileFailureResult(
      diagnosticsFromBuildFailure(error),
      entry.graphRef.current,
      input.entryAbsolutePath,
      input.projectRoot,
      input.contentRoot
    );
    // Drop the cached context so the next reload re-reads files and the stub.
    // Incremental reuse after a missing-export failure can keep the old graph.
    // Identity-checked: a timed-out compile must not dispose the successor
    // context a user retry has already created under the same key.
    await disposeCompileContextIfCurrent(contextKey, entry);
    return failure;
  }
}
