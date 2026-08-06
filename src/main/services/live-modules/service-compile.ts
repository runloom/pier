import { join } from "node:path";
import type {
  LiveModuleCompileResult,
  LiveModuleEvent,
} from "@shared/contracts/live-modules.ts";
import { LIVE_MODULE_DEFAULT_PREVIEW_BARREL } from "@shared/contracts/live-modules.ts";
import {
  detectLiveModuleFrameworkFromFileName,
  isLiveModuleCanvasFileName,
} from "@shared/live-module-framework.ts";
import { compileLiveModule } from "./compile.ts";
import {
  cancelCompileContext,
  esbuildContextKey,
} from "./compile-context-cache.ts";
import {
  assertPathInsideRoot,
  LiveModuleFenceError,
  resolveUnderRoot,
} from "./fence.ts";
import type { LiveModuleGraphTracker } from "./graph.ts";
import type { RegisteredLiveRoot } from "./root-registry.ts";
import {
  artifactUrl,
  type LiveModuleTicketRegistry,
} from "./ticket-registry.ts";

export interface CompileModuleContext {
  compileEpochs: Map<string, number>;
  compileTail: Map<string, Promise<void>>;
  emit: (event: LiveModuleEvent) => void;
  getRoot: (rootId: string) => RegisteredLiveRoot | undefined;
  graphTracker: LiveModuleGraphTracker;
  moduleKey: (rootId: string, moduleId: string) => string;
  moduleTickets: Map<string, string>;
  scheduleTicketRevoke: (ticket: string) => void;
  tickets: LiveModuleTicketRegistry;
  timeoutMs: number;
}

/**
 * Run one canvas compile with per-module serialization and epoch supersede.
 */
export async function runLiveModuleCompile(
  ctx: CompileModuleContext,
  rootId: string,
  relPath: string
): Promise<LiveModuleCompileResult> {
  const root = ctx.getRoot(rootId);
  if (!root) {
    return {
      diagnostics: [
        { message: `unknown live root: ${rootId}`, severity: "error" },
      ],
      ok: false,
    };
  }

  if (!isLiveModuleCanvasFileName(relPath)) {
    return {
      diagnostics: [
        {
          message:
            "live modules entry must use a canvas suffix (.canvas.tsx/.vue/.svelte/.canvas.solid.tsx, …)",
          severity: "error",
        },
      ],
      ok: false,
    };
  }
  const framework = detectLiveModuleFrameworkFromFileName(relPath) ?? "react";

  if (!root.projectRoot && framework !== "react") {
    const failure: LiveModuleCompileResult = {
      diagnostics: [
        {
          message: `${framework} canvases need an open project (framework packages resolve from the project). Use a React canvas for pier-home, or open a project folder.`,
          severity: "error",
        },
      ],
      ok: false,
    };
    ctx.emit({
      diagnostics: failure.diagnostics,
      moduleId: relPath,
      rootId,
      type: "diagnostics",
    });
    return failure;
  }

  const key = ctx.moduleKey(rootId, relPath);
  const epoch = (ctx.compileEpochs.get(key) ?? 0) + 1;
  ctx.compileEpochs.set(key, epoch);

  const previousTail = ctx.compileTail.get(key) ?? Promise.resolve();
  let releaseTail!: () => void;
  const tailGate = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  ctx.compileTail.set(
    key,
    previousTail.then(
      () => tailGate,
      () => tailGate
    )
  );
  await previousTail.catch(() => undefined);

  if (ctx.compileEpochs.get(key) !== epoch) {
    releaseTail();
    return {
      diagnostics: [
        {
          message: "compile superseded by a newer request",
          severity: "error",
        },
      ],
      ok: false,
    };
  }

  try {
    const entryAbsolute = resolveUnderRoot(root.contentRoot, relPath, "canvas");
    const entryReal = assertPathInsideRoot(
      entryAbsolute,
      root.projectRoot ?? root.contentRoot,
      "canvas"
    );

    let previewBarrelAbsolutePath: string | undefined;
    if (
      root.spec.resolve.previewBarrel ||
      root.spec.resolve.forcePreviewBarrel
    ) {
      if (!root.projectRoot) {
        return {
          diagnostics: [
            {
              message: "preview barrel is only supported on project roots",
              severity: "error",
            },
          ],
          ok: false,
        };
      }
      const barrelRel =
        root.spec.resolve.previewBarrel ?? LIVE_MODULE_DEFAULT_PREVIEW_BARREL;
      previewBarrelAbsolutePath = resolveUnderRoot(
        root.projectRoot,
        barrelRel,
        "preview barrel"
      );
    }

    const compilePromise = compileLiveModule({
      allowNodeModules: root.spec.resolve.allowNodeModules,
      contentRoot: root.contentRoot,
      entryAbsolutePath: entryReal,
      forcePreviewBarrel: root.spec.resolve.forcePreviewBarrel,
      framework,
      moduleId: relPath,
      previewBarrelAbsolutePath,
      projectRoot: root.projectRoot,
      rootId,
      tsconfigPaths: root.spec.resolve.tsconfigPaths,
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const result = await Promise.race([
      compilePromise.finally(() => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          if (ctx.compileEpochs.get(key) === epoch) {
            ctx.compileEpochs.set(key, epoch + 1);
          }
          // Cancel the in-flight esbuild rebuild so it doesn't keep consuming CPU.
          // Key must match compileLiveModule's (options included).
          cancelCompileContext(
            esbuildContextKey({
              allowNodeModules: root.spec.resolve.allowNodeModules,
              contentRoot: root.contentRoot,
              entryAbsolutePath: entryReal,
              forcePreviewBarrel: root.spec.resolve.forcePreviewBarrel,
              framework,
              previewBarrelAbsolutePath,
              projectRoot: root.projectRoot,
              rootId,
              tsconfigPaths: root.spec.resolve.tsconfigPaths,
            })
          ).catch(() => undefined);
          reject(new Error(`compile timed out after ${ctx.timeoutMs}ms`));
        }, ctx.timeoutMs);
      }),
    ]);

    if (ctx.compileEpochs.get(key) !== epoch) {
      return {
        diagnostics: [
          {
            message: timedOut
              ? `compile timed out after ${ctx.timeoutMs}ms`
              : "compile superseded by a newer request",
            severity: "error",
          },
        ],
        ok: false,
        superseded: !timedOut,
      };
    }

    if (!result.ok) {
      const absoluteGraph = (result.graph ?? []).map((rel) =>
        join(root.projectRoot ?? root.contentRoot, rel)
      );
      absoluteGraph.push(entryReal);
      ctx.graphTracker.setModuleGraph(rootId, relPath, absoluteGraph);
      ctx.emit({
        diagnostics: result.diagnostics,
        moduleId: relPath,
        rootId,
        type: "diagnostics",
      });
      return result;
    }

    const previousTicket = ctx.moduleTickets.get(key);
    if (previousTicket) {
      ctx.scheduleTicketRevoke(previousTicket);
    }
    const artifact = ctx.tickets.put({
      bytes: Buffer.from(result.bytes),
      graph: result.graph,
      moduleId: relPath,
      rootId,
    });
    ctx.moduleTickets.set(key, artifact.ticket);

    const absoluteGraph = result.graph.map((rel) =>
      join(root.projectRoot ?? root.contentRoot, rel)
    );
    absoluteGraph.push(entryReal);
    ctx.graphTracker.setModuleGraph(rootId, relPath, absoluteGraph);

    const success: LiveModuleCompileResult = {
      graph: result.graph,
      moduleId: relPath,
      ok: true,
      url: artifactUrl(artifact),
    };
    if (result.warnings && result.warnings.length > 0) {
      success.warnings = result.warnings;
    }
    ctx.emit({ moduleId: relPath, rootId, type: "changed" });
    return success;
  } catch (error) {
    if (ctx.compileEpochs.get(key) !== epoch) {
      return {
        diagnostics: [
          {
            message:
              error instanceof Error && /timed out/u.test(error.message)
                ? error.message
                : "compile superseded by a newer request",
            severity: "error",
          },
        ],
        ok: false,
        superseded: !(
          error instanceof Error && /timed out/u.test(error.message)
        ),
      };
    }
    let message: string;
    if (error instanceof LiveModuleFenceError) {
      message = error.diagnosticMessage;
    } else if (error instanceof Error) {
      message = error.message;
    } else {
      message = String(error);
    }
    const failure: LiveModuleCompileResult = {
      diagnostics: [{ message, severity: "error" }],
      ok: false,
    };
    ctx.emit({
      diagnostics: failure.diagnostics,
      moduleId: relPath,
      rootId,
      type: "diagnostics",
    });
    return failure;
  } finally {
    releaseTail();
  }
}
