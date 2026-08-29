/**
 * Language-server provider contract (main-side registry).
 * Launch specs are plain data so SessionHost stays language-agnostic.
 */

import { z } from "zod";

export interface LspDocumentSelector {
  extensions: readonly string[];
  languageIds: readonly string[];
}

export interface LspServerLaunchSpec {
  args: readonly string[];
  command: string;
  cwd: string;
  env?: Readonly<Record<string, string>>;
  /**
   * Merged into the client's `initialize` params by the session runtime.
   * Used when the editor client cannot pass server-specific options (e.g.
   * CodeMirror lsp-client has no initializationOptions hook).
   */
  initializationOptions?: Readonly<Record<string, unknown>>;
}

export interface LspServerProvider {
  readonly displayName: string;
  readonly id: string;
  /**
   * Optional shell command shown when the server binary is missing.
   * Contributed by core catalog or language plugins — not hardcoded in Files.
   */
  readonly installCommand?: string;

  /**
   * Map path → LSP languageId for didOpen. null if path is not served.
   */
  languageIdForPath(path: string): string | null;

  matchPath(path: string): boolean;
  readonly priority: number;

  resolveLaunch(input: {
    rootPath: string;
    workspaceKey: string;
  }): LspServerLaunchSpec | null | Promise<LspServerLaunchSpec | null>;

  resolveRoot(input: {
    fallbackWorkspaceRoot: string;
    filePath: string;
  }): string;
  readonly rootMarkers: readonly string[];
  readonly selector: LspDocumentSelector;
  /** Origin of this provider for settings / diagnostics. */
  readonly source?: LspProviderSource;
}

export const lspProviderSourceSchema = z.enum(["core", "custom", "plugin"]);
export type LspProviderSource = z.infer<typeof lspProviderSourceSchema>;

const extensionSchema = z
  .string()
  .min(2)
  .regex(/^\.[A-Za-z0-9_.+-]+$/u, "extension must start with '.'");

/**
 * Serializable provider recipe used by L0 factories, L1 custom prefs, and L2 plugins.
 */
const lspLaunchCandidateSchema = z
  .object({
    args: z.array(z.string()).default([]),
    command: z.string().min(1),
  })
  .strict();

export const lspProviderDescriptorSchema = z
  .object({
    args: z.array(z.string()).default([]),
    command: z.string().min(1),
    /** Alternate bare names tried on PATH when `command` is missing. */
    commandCandidates: z.array(z.string().min(1)).optional(),
    /**
     * Ordered launch attempts with distinct args (Swift: sourcekit-lsp, xcrun …).
     */
    launchCandidates: z.array(lspLaunchCandidateSchema).min(1).optional(),
    /**
     * Root-relative binaries tried before PATH candidates (FVM SDK, etc.).
     */
    workspaceRelativeCommands: z
      .array(lspLaunchCandidateSchema)
      .min(1)
      .optional(),
    /**
     * When any marker exists at the server root, listed PATH commands are
     * tried before the remaining launchCandidates.
     */
    preferLaunchCommandsWhenMarkers: z
      .object({
        commands: z.array(z.string().min(1)).min(1),
        markers: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
    displayName: z.string().min(1),
    extensions: z.array(extensionSchema).min(1),
    id: z.string().min(1),
    /** Shown when binary missing; optional. */
    installCommand: z.string().min(1).optional(),
    /**
     * Inject `initialize.initializationOptions.typescript.tsdk` from the
     * workspace TypeScript lib, falling back to Pier's bundled SDK. Required
     * by servers such as astro-ls that crash when tsdk is undefined.
     */
    injectTypescriptSdk: z.boolean().optional(),
    /**
     * languageId used for didOpen. When omitted, derived from the first
     * extension without the leading dot (e.g. `.py` → `py` is wrong — callers
     * should set languageIds explicitly for multi-ext languages).
     */
    languageIdByExtension: z.record(z.string(), z.string().min(1)).optional(),
    languageIds: z.array(z.string().min(1)).min(1),
    /**
     * Basename matchers (case-insensitive). Supports exact names or a single
     * trailing `.*` prefix form (`dockerfile.*` → Dockerfile / Dockerfile.dev).
     */
    basenameMatchers: z.array(z.string().min(1)).optional(),
    pluginId: z.string().min(1).optional(),
    priority: z.number().int().min(0).max(100).default(50),
    rootMarkers: z.array(z.string().min(1)).default([]),
    source: lspProviderSourceSchema,
  })
  .strict();

export type LspProviderDescriptor = z.infer<typeof lspProviderDescriptorSchema>;

/** Catalog row for settings UI (core list is static; availability is probed). */
export const lspCatalogEntrySchema = z
  .object({
    binaryHint: z.string().min(1),
    displayName: z.string().min(1),
    extensions: z.array(z.string().min(1)),
    id: z.string().min(1),
    /** Optional install command for settings / missing-binary UX. */
    installCommand: z.string().min(1).optional(),
    source: lspProviderSourceSchema,
  })
  .strict();

export type LspCatalogEntry = z.infer<typeof lspCatalogEntrySchema>;

export const lspBinaryStatusSchema = z.enum([
  "bundled",
  "available",
  "missing",
]);
export type LspBinaryStatus = z.infer<typeof lspBinaryStatusSchema>;

export const lspCatalogStatusRowSchema = z
  .object({
    binaryHint: z.string().min(1),
    displayName: z.string().min(1),
    extensions: z.array(z.string().min(1)),
    id: z.string().min(1),
    installCommand: z.string().min(1).optional(),
    /** Absolute PATH hit when `status` is `available`. */
    resolvedPath: z.string().min(1).optional(),
    source: lspProviderSourceSchema,
    status: lspBinaryStatusSchema,
    /** First line of `--version` stdout when the binary exited 0 in time. */
    version: z.string().min(1).max(64).optional(),
  })
  .strict();

export type LspCatalogStatusRow = z.infer<typeof lspCatalogStatusRowSchema>;

export function parseLspCatalogStatusRows(
  value: unknown
): LspCatalogStatusRow[] | null {
  const parsed = z.array(lspCatalogStatusRowSchema).safeParse(value);
  return parsed.success ? parsed.data : null;
}
