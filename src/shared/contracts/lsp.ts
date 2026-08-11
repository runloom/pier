import { z } from "zod";

export const LSP_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

function utf8ByteLength(value: string): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7_ff) {
      byteLength += 2;
    } else if (
      codeUnit >= 0xd8_00 &&
      codeUnit <= 0xdb_ff &&
      index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc_00 && nextCodeUnit <= 0xdf_ff) {
        byteLength += 4;
        index += 1;
      } else {
        byteLength += 3;
      }
    } else {
      byteLength += 3;
    }

    if (byteLength > LSP_MAX_MESSAGE_BYTES) {
      return byteLength;
    }
  }
  return byteLength;
}

const lspMessageSchema = z
  .string()
  .min(1)
  .refine(
    (message) => utf8ByteLength(message) <= LSP_MAX_MESSAGE_BYTES,
    "LSP message exceeds the UTF-8 byte limit"
  );

export const lspWorkspaceKindSchema = z.enum(["local", "remote"]);
export type LspWorkspaceKind = z.infer<typeof lspWorkspaceKindSchema>;

export const lspDenyReasonSchema = z.enum([
  "globally-disabled",
  "worktrees-disabled",
  "limit-reached",
  "unsupported-root",
  "no-provider",
  "server-unavailable",
  "launch-failed",
  "cleanup-failed",
]);
export type LspDenyReason = z.infer<typeof lspDenyReasonSchema>;

const lspCustomServerExtensionSchema = z
  .string()
  .min(2)
  .regex(/^\.[A-Za-z0-9_.+-]+$/u, "extension must start with '.'");

/**
 * User-defined PATH language server (L1). Runtime provider id is `custom:{id}`.
 */
export const lspCustomServerSchema = z
  .object({
    args: z.array(z.string()).default([]),
    command: z.string().min(1),
    commandCandidates: z.array(z.string().min(1)).optional(),
    displayName: z.string().min(1),
    extensions: z.array(lspCustomServerExtensionSchema).min(1),
    /**
     * Editor highlight preset for the display track (see language-mode matrix).
     * Defaults to text when omitted (backward compatible).
     */
    highlightPreset: z
      .enum([
        "text",
        "javascript",
        "typescript",
        "jsx",
        "html",
        "xml",
        "css",
        "json",
        "yaml",
        "markdown",
        "python",
        "go",
        "rust",
        "clike",
        "cpp",
        "java",
        "csharp",
        "kotlin",
        "shell",
        "sql",
        "toml",
        "ruby",
        "swift",
        "vue",
        "svelte",
      ])
      .default("text"),
    id: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._-]+$/u, "id must be a simple token"),
    languageIdByExtension: z.record(z.string(), z.string().min(1)).optional(),
    languageIds: z.array(z.string().min(1)).min(1),
    priority: z.number().int().min(0).max(100).default(50),
    rootMarkers: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type LspCustomServer = z.infer<typeof lspCustomServerSchema>;

export const lspPolicyPrefsSchema = z.object({
  customServers: z.array(lspCustomServerSchema).default([]),
  enabled: z.boolean().default(true),
  idleReleaseMs: z
    .number()
    .int()
    .min(60_000)
    .max(24 * 3_600_000)
    .default(1_800_000),
  maxLocalWorkspaces: z.number().int().min(0).max(32).default(3),
  maxRemoteWorkspaces: z.number().int().min(0).max(32).default(2),
  worktreesEnabled: z.boolean().default(false),
});
export type LspPolicyPrefs = z.infer<typeof lspPolicyPrefsSchema>;

export const DEFAULT_LSP_POLICY_PREFS: LspPolicyPrefs = {
  customServers: [],
  enabled: true,
  idleReleaseMs: 1_800_000,
  maxLocalWorkspaces: 3,
  maxRemoteWorkspaces: 2,
  worktreesEnabled: false,
};

export const lspSessionEnsureRequestSchema = z.object({
  /**
   * Absolute path of the file being edited. Used for provider match + root
   * markers. When omitted, falls back to typescript provider + rootPath.
   */
  filePath: z.string().min(1).optional(),
  isWorktree: z.boolean().optional(),
  kind: lspWorkspaceKindSchema.default("local"),
  /** Absolute workspace / project root (fallback root, not always server cwd). */
  rootPath: z.string().min(1),
  /** Stable workspace key; default main:${rootPath}. */
  workspaceKey: z.string().min(1).optional(),
});
export type LspSessionEnsureRequest = z.infer<
  typeof lspSessionEnsureRequestSchema
>;

export const lspSessionEnsureSuccessSchema = z.object({
  languageId: z.string().min(1),
  ok: z.literal(true),
  rootPath: z.string().min(1),
  serverId: z.string().min(1),
  sessionId: z.string().min(1),
  workspaceKey: z.string().min(1),
});
export type LspSessionEnsureSuccess = z.infer<
  typeof lspSessionEnsureSuccessSchema
>;

export const lspSessionEnsureFailureSchema = z.object({
  ok: z.literal(false),
  reason: lspDenyReasonSchema,
  rootPath: z.string().min(1),
  serverId: z.string().min(1).optional(),
  workspaceKey: z.string().min(1),
});
export type LspSessionEnsureFailure = z.infer<
  typeof lspSessionEnsureFailureSchema
>;

export const lspSessionEnsureResultSchema = z.discriminatedUnion("ok", [
  lspSessionEnsureSuccessSchema,
  lspSessionEnsureFailureSchema,
]);
export type LspSessionEnsureResult = z.infer<
  typeof lspSessionEnsureResultSchema
>;

export const lspSessionSendRequestSchema = z
  .object({
    message: lspMessageSchema,
    sessionId: z.string().min(1),
  })
  .strict();
export type LspSessionSendRequest = z.infer<typeof lspSessionSendRequestSchema>;

export const lspSessionCloseRequestSchema = z.object({
  sessionId: z.string().min(1),
});
export type LspSessionCloseRequest = z.infer<
  typeof lspSessionCloseRequestSchema
>;

/** Directed main → renderer event: bare JSON-RPC body (no Content-Length). */
export const lspSessionMessageEventSchema = z
  .object({
    message: lspMessageSchema,
    sessionId: z.string().min(1),
  })
  .strict();
export type LspSessionMessageEvent = z.infer<
  typeof lspSessionMessageEventSchema
>;

export const lspSessionCloseCauseSchema = z.enum([
  "client-release",
  "policy-disabled",
  "workspace-evicted",
  "idle-release",
  "owner-destroyed",
  "app-quit",
]);
export type LspSessionCloseCause = z.infer<typeof lspSessionCloseCauseSchema>;

export const lspSessionClosedEventSchema = z.discriminatedUnion("reason", [
  z
    .object({
      cause: lspSessionCloseCauseSchema,
      reason: z.literal("closed"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      reason: z.literal("exited"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      reason: z.literal("failed"),
      sessionId: z.string().min(1),
    })
    .strict(),
]);
export type LspSessionClosedEvent = z.infer<typeof lspSessionClosedEventSchema>;
