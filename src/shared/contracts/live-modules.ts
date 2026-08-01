import { z } from "zod";
import { assetRootRefSchema } from "./agent/assets.ts";

/**
 * Live Modules host contract (C 轨).
 *
 * Trust model (v1): compiled modules run in the **main renderer same realm** as
 * the host UI. Trust level equals “the user opened this project” — not a
 * sandbox. Opaque `pier-live://` tickets map to cache bytes on the main side;
 * URLs must never embed filesystem paths.
 *
 * Defaults (plan §0):
 * - preview barrel path hint: `.pier/preview-exports.ts`
 * - `forcePreviewBarrel` default false (encourage, do not force)
 * - `allowNodeModules` default false
 * - home roots forbid `tsconfigPaths: true`
 * - React is the core host path (`pier/canvas`). Vue / Solid / Svelte canvases
 *   are first-class entries (suffix-selected); their runtimes come from the
 *   **project** packages, not a second host UI stack.
 */

/** Recommended preview barrel relative to project root (encourage, not force). */
export const LIVE_MODULE_DEFAULT_PREVIEW_BARREL = ".pier/preview-exports.ts";

export const LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY = ".pier/canvases";
export const LIVE_MODULE_DEFAULT_HOME_DIRECTORY = "canvases";
/** Library scan glob (multi-framework entry names). */
export const LIVE_MODULE_DEFAULT_PATTERN =
  "**/*.{canvas.tsx,canvas.jsx,canvas.vue,canvas.svelte,canvas.solid.tsx,canvas.solid.jsx}";

/** Broadcast channel for compile/watch invalidation (payload: LiveModuleEvent). */
export const LIVE_MODULES_CHANGED_CHANNEL = "pier://live-modules:changed";

const relativePathSegmentSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !(
        value.startsWith("/") ||
        value.includes("\0") ||
        value.split(/[/\\]/u).some((part) => part === "..")
      ),
    "path must be relative and must not contain .."
  );

export const liveModuleDiagnosticSchema = z
  .object({
    column: z.number().int().positive().optional(),
    file: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    message: z.string().min(1),
    severity: z.enum(["error", "warning"]),
  })
  .strict();

export type LiveModuleDiagnostic = z.infer<typeof liveModuleDiagnosticSchema>;

export const liveRootResolveSchema = z
  .object({
    /**
     * Inherit tsconfig paths for project roots.
     * Home roots must keep this false (enforced by liveRootSpecSchema).
     */
    tsconfigPaths: z.boolean(),
    /** Optional barrel relative to project root; ignored for home unless later allowed. */
    previewBarrel: relativePathSegmentSchema.optional(),
    /**
     * When true, canvas imports must resolve via the preview barrel
     * (plus pier/canvas). Default false — encourage, do not force.
     */
    forcePreviewBarrel: z.boolean().default(false),
    /** v1 default false; bare node_modules specifiers denied unless later allowlisted. */
    allowNodeModules: z.boolean().default(false),
  })
  .strict();

export type LiveRootResolve = z.infer<typeof liveRootResolveSchema>;

export const liveRootSpecSchema = z
  .object({
    /** Stable root id, e.g. "pier.canvas.project". */
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9._-]*$/u, "invalid live root id"),
    /**
     * Reuses Agent Assets AssetRootRef.
     * - project: requires projectRootPath (service rejects pier-home impersonation)
     * - home: no client-supplied path
     */
    anchor: assetRootRefSchema,
    /** Directory relative to the anchor root (projectRoot or pier-home). */
    directory: relativePathSegmentSchema,
    /**
     * Glob under directory (reserved for P Library scan).
     * Compile accepts multi-framework canvas suffixes (see live-module-framework).
     */
    pattern: z.string().min(1).max(256),
    resolve: liveRootResolveSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.anchor.scope === "home" && value.resolve.tsconfigPaths) {
      ctx.addIssue({
        code: "custom",
        message: "home live roots forbid tsconfigPaths",
        path: ["resolve", "tsconfigPaths"],
      });
    }
  });

export type LiveRootSpec = z.infer<typeof liveRootSpecSchema>;

export const liveModuleIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._/-]+$/u, "invalid live module id");

export const liveModuleCompileSuccessSchema = z
  .object({
    graph: z.array(z.string().min(1)),
    moduleId: liveModuleIdSchema,
    ok: z.literal(true),
    /** Opaque pier-live://module/<ticket> URL — never a filesystem path. */
    url: z.string().min(1),
  })
  .strict();

export const liveModuleCompileFailureSchema = z
  .object({
    diagnostics: z.array(liveModuleDiagnosticSchema).min(1),
    ok: z.literal(false),
  })
  .strict();

export const liveModuleCompileResultSchema = z.discriminatedUnion("ok", [
  liveModuleCompileSuccessSchema,
  liveModuleCompileFailureSchema,
]);

export type LiveModuleCompileResult = z.infer<
  typeof liveModuleCompileResultSchema
>;

export const liveModuleEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      moduleId: liveModuleIdSchema,
      rootId: z.string().min(1),
      type: z.literal("changed"),
    })
    .strict(),
  z
    .object({
      moduleId: liveModuleIdSchema,
      rootId: z.string().min(1),
      type: z.literal("stale"),
    })
    .strict(),
  z
    .object({
      diagnostics: z.array(liveModuleDiagnosticSchema).min(1),
      moduleId: liveModuleIdSchema.optional(),
      rootId: z.string().min(1),
      type: z.literal("diagnostics"),
    })
    .strict(),
]);

export type LiveModuleEvent = z.infer<typeof liveModuleEventSchema>;

/**
 * Main-process service API (in-process).
 * Renderer / plugins use IPC façade `window.pier.liveModules` /
 * `context.liveModules` instead: async `registerRoot` → `{ rootId }`,
 * async `getUrl`, and global `onChanged` (broadcast), not per-root `subscribe`.
 */
export interface LiveModulesApi {
  compile(rootId: string, relPath: string): Promise<LiveModuleCompileResult>;
  getUrl(rootId: string, moduleId: string): string;
  /**
   * Register or replace a root. Returns dispose for the registration snapshot
   * (in-process). Prefer retainRoot/releaseRoot from IPC for refcounted lifecycle.
   */
  registerRoot(spec: LiveRootSpec): () => void;
  /** Decrement retain; dispose root + watchers/tickets when count hits 0. */
  releaseRoot(rootId: string): void;
  /** Increment retain count and ensure the root is registered. */
  retainRoot(spec: LiveRootSpec): string;
  subscribe(rootId: string, cb: (event: LiveModuleEvent) => void): () => void;
}

/**
 * Stable live root id for a project path (multi-worktree safe).
 * Charset matches liveRootSpecSchema id (a-z0-9._-).
 */
export function projectLiveRootId(projectRootPath: string): string {
  const normalized = projectRootPath
    .replaceAll("\\", "/")
    .replace(/\/+$/u, "")
    .toLowerCase();
  // Dual FNV-1a so different paths do not share one global root id.
  let h1 = 0x81_1c_9d_c5;
  // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash needs xor/unsigned shift
  let h2 = 0x81_1c_9d_c5 ^ 0x9e_37_79_b9;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash needs xor/unsigned shift
    h1 = Math.imul(h1 ^ code, 0x01_00_01_93) >>> 0;
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash needs xor/unsigned shift
    h2 = Math.imul(h2 ^ code, 0x01_00_01_93) >>> 0;
  }
  return `pier.canvas.project.${h1.toString(36)}.${h2.toString(36)}`;
}

/** Convenience builders for the two Agent Assets roots. */
export function projectLiveRootSpec(input: {
  id?: string;
  projectRootPath: string;
  directory?: string;
  pattern?: string;
  resolve?: Partial<LiveRootResolve>;
}): LiveRootSpec {
  return liveRootSpecSchema.parse({
    anchor: { scope: "project", projectRootPath: input.projectRootPath },
    directory: input.directory ?? LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
    id: input.id ?? projectLiveRootId(input.projectRootPath),
    pattern: input.pattern ?? LIVE_MODULE_DEFAULT_PATTERN,
    resolve: {
      allowNodeModules: false,
      forcePreviewBarrel: false,
      tsconfigPaths: true,
      ...input.resolve,
    },
  });
}

export function homeLiveRootSpec(input?: {
  id?: string;
  directory?: string;
  pattern?: string;
  resolve?: Partial<Omit<LiveRootResolve, "tsconfigPaths">>;
}): LiveRootSpec {
  return liveRootSpecSchema.parse({
    anchor: { scope: "home" },
    directory: input?.directory ?? LIVE_MODULE_DEFAULT_HOME_DIRECTORY,
    id: input?.id ?? "pier.canvas.home",
    pattern: input?.pattern ?? LIVE_MODULE_DEFAULT_PATTERN,
    resolve: {
      allowNodeModules: false,
      forcePreviewBarrel: false,
      ...input?.resolve,
      tsconfigPaths: false,
    },
  });
}

export const liveModulesRegisterRootRequestSchema = z
  .object({
    spec: liveRootSpecSchema,
  })
  .strict();

export const liveModulesCompileRequestSchema = z
  .object({
    relPath: relativePathSegmentSchema,
    rootId: z.string().min(1),
  })
  .strict();

export const liveModulesGetUrlRequestSchema = z
  .object({
    moduleId: liveModuleIdSchema,
    rootId: z.string().min(1),
  })
  .strict();

export const liveModulesUnregisterRootRequestSchema = z
  .object({
    rootId: z.string().min(1),
  })
  .strict();
