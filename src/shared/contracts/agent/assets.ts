import { z } from "zod";

/** Explicit asset scope — home never accepts a client-supplied path. */
export const assetRootRefSchema = z.discriminatedUnion("scope", [
  z
    .object({
      projectRootPath: z.string().min(1),
      scope: z.literal("project"),
    })
    .strict(),
  z.object({ scope: z.literal("home") }).strict(),
]);

export type AssetRootRef = z.infer<typeof assetRootRefSchema>;

export const ruleFileIdSchema = z.enum([
  "agents-md",
  "claude-md",
  "gemini-md",
  "cursor-rules",
]);

export type RuleFileId = z.infer<typeof ruleFileIdSchema>;

export const ruleFileStateSchema = z.enum([
  "missing",
  "file",
  "directory",
  "other",
]);

export type RuleFileState = z.infer<typeof ruleFileStateSchema>;

export const ruleFileViewSchema = z
  .object({
    id: ruleFileIdSchema,
    relativePath: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
    state: ruleFileStateSchema,
    updatedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export type RuleFileView = z.infer<typeof ruleFileViewSchema>;

export const rulesSnapshotSchema = z
  .object({
    files: z.array(ruleFileViewSchema),
    rootPath: z.string().min(1),
    scope: z.enum(["project", "home"]),
  })
  .strict();

export type RulesSnapshot = z.infer<typeof rulesSnapshotSchema>;

export const rulesSnapshotRequestSchema = z
  .object({
    root: assetRootRefSchema,
  })
  .strict();

export const rulesReadRequestSchema = z
  .object({
    id: ruleFileIdSchema,
    root: assetRootRefSchema,
  })
  .strict();

export const rulesWriteRequestSchema = z
  .object({
    content: z
      .string()
      .refine(
        (value) => new TextEncoder().encode(value).byteLength <= 512 * 1024,
        "content exceeds 512 KiB"
      ),
    id: ruleFileIdSchema,
    root: assetRootRefSchema,
  })
  .strict();

export const rulesEnsureRequestSchema = z
  .object({
    id: ruleFileIdSchema,
    root: assetRootRefSchema,
  })
  .strict();

export const rulesReadResultSchema = z
  .object({
    content: z.string(),
    id: ruleFileIdSchema,
    relativePath: z.string().min(1),
    truncated: z.boolean().default(false),
  })
  .strict();

export type RulesReadResult = z.infer<typeof rulesReadResultSchema>;

/** Canonical Pier-managed MCP server key written into agent configs. */
export const PIER_MANAGED_MCP_SERVER_NAME = "pier-memory" as const;

/** MCP catalog */
export const mcpCatalogScopeLabelSchema = z.enum(["project", "user"]);

export const mcpTransportSchema = z.enum(["stdio", "http", "unknown"]);

export type McpTransport = z.infer<typeof mcpTransportSchema>;

export const mcpOwnershipSchema = z.enum(["pier-managed", "project", "user"]);

export type McpOwnership = z.infer<typeof mcpOwnershipSchema>;

export const mcpEnabledRollupSchema = z.enum(["on", "off", "mixed"]);

export type McpEnabledRollup = z.infer<typeof mcpEnabledRollupSchema>;

export const mcpTransportRollupSchema = z.enum([
  "stdio",
  "http",
  "unknown",
  "mixed",
]);

export type McpTransportRollup = z.infer<typeof mcpTransportRollupSchema>;

export const mcpCatalogPresenceSchema = z.enum([
  "present",
  "missing",
  "unsupported",
]);

export type McpCatalogPresence = z.infer<typeof mcpCatalogPresenceSchema>;

export const mcpCatalogEntrySchema = z
  .object({
    absolutePath: z.string().nullable(),
    agentId: z.string().min(1),
    agentLabel: z.string().min(1),
    displayPath: z.string().min(1),
    id: z.string().min(1),
    officialDocsUrl: z.string().url().optional(),
    presence: mcpCatalogPresenceSchema,
    scopeLabel: mcpCatalogScopeLabelSchema,
  })
  .strict();

export type McpCatalogEntry = z.infer<typeof mcpCatalogEntrySchema>;

/** One agent/config source that declares a named MCP server (no payloads). */
export const mcpServerListingSchema = z
  .object({
    /** Absolute config path for `window.pier.files` reveal/open. */
    absolutePath: z.string().min(1),
    agentId: z.string().min(1),
    agentLabel: z.string().min(1),
    displayPath: z.string().min(1),
    enabled: z.boolean(),
    /** Catalog entry id (whitelist / diagnostics). */
    entryId: z.string().min(1),
    scopeLabel: mcpCatalogScopeLabelSchema,
    transport: mcpTransportSchema,
  })
  .strict();

export type McpServerListing = z.infer<typeof mcpServerListingSchema>;

/**
 * Per-agent availability for an MCP server name — mirrors skills
 * `SkillEffectiveCell` (discoverable = recognized via a configured MCP path).
 */
export const mcpAgentEffectSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("discoverable"),
      /** Config path that declared the server (skills `viaRoot` parallel). */
      viaRoot: z.string().min(1),
    })
    .strict(),
  z.object({ state: z.literal("agent-not-installed") }).strict(),
]);

export type McpAgentEffect = z.infer<typeof mcpAgentEffectSchema>;

export const mcpAgentEffectCellSchema = z
  .object({
    agentKind: z.string().min(1),
    effect: mcpAgentEffectSchema,
  })
  .strict();

export type McpAgentEffectCell = z.infer<typeof mcpAgentEffectCellSchema>;

export const mcpGapSchema = z
  .object({
    agentKind: z.string().min(1),
  })
  .strict();

export type McpGap = z.infer<typeof mcpGapSchema>;

export const mcpServerViewSchema = z
  .object({
    enabled: mcpEnabledRollupSchema,
    /** Skills-style availability matrix for installed / declaring agents. */
    effects: z.array(mcpAgentEffectCellSchema),
    /** Installed MCP-consuming agents that did not declare this name. */
    gaps: z.array(mcpGapSchema),
    listings: z.array(mcpServerListingSchema).min(1),
    name: z.string().min(1),
    ownership: mcpOwnershipSchema,
    transport: mcpTransportRollupSchema,
  })
  .strict();

export type McpServerView = z.infer<typeof mcpServerViewSchema>;

export const mcpCatalogSnapshotSchema = z
  .object({
    /** Path presence rows (Reveal/Open targets); UI prefers `servers`. */
    entries: z.array(mcpCatalogEntrySchema),
    scope: z.enum(["project", "home"]),
    /** Aggregated MCP server names → which agents declare them. */
    servers: z.array(mcpServerViewSchema),
  })
  .strict();

export type McpCatalogSnapshot = z.infer<typeof mcpCatalogSnapshotSchema>;

export const agentMcpCatalogRequestSchema = z
  .object({
    root: assetRootRefSchema,
  })
  .strict();

export const agentMcpPathActionRequestSchema = z
  .object({
    entryId: z.string().min(1),
    root: assetRootRefSchema,
  })
  .strict();

export const agentMcpPathActionResultSchema = z
  .object({
    absolutePath: z.string().min(1),
    ok: z.literal(true),
  })
  .strict();

export type AgentMcpPathActionResult = z.infer<
  typeof agentMcpPathActionResultSchema
>;
