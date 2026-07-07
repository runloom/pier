import { z } from "zod";
import { pluginDashboardWidgetContributionSchema } from "./dashboard.ts";
import { pierCapabilitySchema } from "./permissions.ts";
import {
  pluginCommandContributionSchema,
  pluginConfigurationSchema,
  pluginLocalizationSchema,
  pluginPanelContributionSchema,
  pluginTerminalStatusItemContributionSchema,
} from "./plugin.ts";

/**
 * Managed plugin package manifest (`plugin.json` shipped inside `.tgz`).
 * Distinct from the runtime-registry manifest (`pluginManifestSchema`):
 *
 * - No `source` field — install source is authoritative in `index.json`,
 *   not self-declared by the package (design §4.1).
 * - Explicit `main` / `renderer` entry paths with POSIX-relative safety.
 * - Optional `dataSchemas` used for rollback compatibility checks
 *   (design §4.1, drops the previously proposed `current` field).
 */

const relativePosixPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), {
    message: "package entry path must not be absolute",
  })
  .refine((value) => !/^[a-zA-Z]:/.test(value), {
    message: "package entry path must not include a drive letter",
  })
  .refine((value) => !value.startsWith("\\\\"), {
    message: "package entry path must not be a UNC path",
  })
  .refine(
    (value) => {
      const segments = value.split("/");
      return segments.every(
        (segment) => segment !== ".." && segment.length > 0
      );
    },
    { message: "package entry path must not contain `..` or empty segments" }
  );

const managedPluginDataSchemaSchema = z.object({
  read: z.string().min(1),
  write: z.number().int().nonnegative(),
});
export type ManagedPluginDataSchema = z.infer<
  typeof managedPluginDataSchemaSchema
>;

export const managedPluginPackageManifestSchema = z.object({
  apiVersion: z.literal(1),
  commands: z.array(pluginCommandContributionSchema).default([]),
  configuration: pluginConfigurationSchema.optional(),
  dashboardWidgets: z
    .array(pluginDashboardWidgetContributionSchema)
    .default([]),
  dataSchemas: z.record(z.string(), managedPluginDataSchemaSchema).optional(),
  description: z.string().min(1).optional(),
  engines: z.object({ pier: z.string().min(1) }),
  homepage: z.string().min(1).optional(),
  id: z.string().min(1),
  localization: pluginLocalizationSchema.optional(),
  main: relativePosixPathSchema,
  name: z.string().min(1),
  panels: z.array(pluginPanelContributionSchema).default([]),
  permissions: z.array(pierCapabilitySchema).default([]),
  publisher: z.string().min(1).optional(),
  renderer: relativePosixPathSchema,
  repository: z.string().min(1).optional(),
  terminalStatusItems: z
    .array(pluginTerminalStatusItemContributionSchema)
    .default([]),
  version: z.string().min(1),
});
export type ManagedPluginPackageManifest = z.infer<
  typeof managedPluginPackageManifestSchema
>;

/**
 * Install-index persistence at `{userData}/plugins/index.json`.
 * Truth source for install/enable/tombstone state.
 */

const installIndexSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("official"),
    seededFromBundle: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("devOverride") }),
]);
export type ManagedPluginInstallSource = z.infer<
  typeof installIndexSourceSchema
>;

const installedVersionRecordSchema = z.object({
  installedAt: z.number().int().nonnegative(),
  packageUrl: z.string().min(1),
  sha256: z.string().min(1),
  verifiedHash: z.string().min(1).optional(),
});
export type ManagedPluginInstalledVersion = z.infer<
  typeof installedVersionRecordSchema
>;

const pendingUpdateSchema = z.object({
  version: z.string().min(1),
  assetUrl: z.string().min(1),
  sha256: z.string().min(1),
  officialIndexSequence: z.number().int().nonnegative(),
});

const pendingRestartKindSchema = z.enum([
  "install",
  "update",
  "enable",
  "disable",
  "uninstall",
  "devOverride",
  "rollback",
]);

const pendingRestartSchema = z.object({
  kind: pendingRestartKindSchema,
  version: z.string().min(1).optional(),
});

const effectiveAtStartupSchema = z.object({
  version: z.string().min(1),
  enabled: z.boolean(),
  sourceKind: z.enum(["official", "devOverride"]),
});

const devOverrideRecordSchema = z.object({
  path: z.string().min(1),
  registeredAt: z.number().int().nonnegative(),
  version: z.string().min(1),
});

export const managedPluginInstallIndexEntrySchema = z.object({
  activeVersion: z.string().min(1).nullable(),
  devOverride: devOverrideRecordSchema.nullable(),
  effectiveAtStartup: effectiveAtStartupSchema.nullable(),
  enabled: z.boolean(),
  id: z.string().min(1),
  installedVersions: z.record(z.string(), installedVersionRecordSchema),
  lastKnownGoodVersion: z.string().min(1).nullable().optional(),
  pendingRestart: pendingRestartSchema.nullable(),
  pendingUpdate: pendingUpdateSchema.nullable(),
  source: installIndexSourceSchema,
  uninstalledAt: z.number().int().nonnegative().optional(),
});
export type ManagedPluginInstallIndexEntry = z.infer<
  typeof managedPluginInstallIndexEntrySchema
>;

export const managedPluginInstallIndexSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), managedPluginInstallIndexEntrySchema),
});
export type ManagedPluginInstallIndex = z.infer<
  typeof managedPluginInstallIndexSchema
>;

/**
 * Central official index — signed envelope fetched from
 * `https://pier.earendil.works/plugins/index.v1.json`.
 * Signature is parsed here but verified in Task 2 (Ed25519 over canonical
 * payload with `signature` field removed). See design §5.
 */

const officialPluginVersionSchema = z.object({
  assetUrl: z.string().min(1),
  pier: z.string().min(1),
  sha256: z.string().min(1),
  size: z.number().int().nonnegative(),
});

const officialPluginEntrySchema = z.object({
  description: z.string().min(1).optional(),
  displayName: z.string().min(1),
  id: z.string().min(1),
  latest: z.string().min(1),
  versions: z.record(z.string(), officialPluginVersionSchema),
});
export type OfficialPluginEntry = z.infer<typeof officialPluginEntrySchema>;

const officialSignatureSchema = z.object({
  alg: z.literal("Ed25519"),
  keyId: z.string().min(1),
  value: z.string().min(1),
});

export const officialPluginIndexSchema = z.object({
  generatedAt: z.number().int().nonnegative(),
  plugins: z.record(z.string(), officialPluginEntrySchema),
  sequence: z.number().int().nonnegative(),
  signature: officialSignatureSchema,
  version: z.literal(1),
});
export type OfficialPluginIndex = z.infer<typeof officialPluginIndexSchema>;

/**
 * Catalog snapshot rendered by the settings UI. Combines install index,
 * official index availability, effective boot-time runtime state,
 * pending restart operations, tombstone state, and diagnostics.
 */

const catalogSourceSchema = z.enum(["official", "devOverride"]);

const catalogStateSchema = z.object({
  enabled: z.boolean(),
  source: catalogSourceSchema,
  version: z.string().min(1).nullable(),
});

const catalogDiagnosticSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  nextAllowedAt: z.number().int().nonnegative().optional(),
});
export type ManagedPluginDiagnostic = z.infer<typeof catalogDiagnosticSchema>;

export const managedPluginCatalogRowSchema = z.object({
  desired: catalogStateSchema,
  diagnostics: z.array(catalogDiagnosticSchema),
  contributionCounts: z
    .object({
      commands: z.number().int().nonnegative(),
      dashboardWidgets: z.number().int().nonnegative(),
      panels: z.number().int().nonnegative(),
      terminalStatusItems: z.number().int().nonnegative(),
    })
    .optional(),
  description: z.string().min(1).optional(),
  displayName: z.string().min(1),
  effective: catalogStateSchema.nullable(),
  id: z.string().min(1),
  installed: z.boolean(),
  lastKnownGoodVersion: z.string().min(1).nullable(),
  offlineRestoreAvailable: z.boolean(),
  pendingRestart: pendingRestartSchema.nullable(),
  update: z.object({ version: z.string().min(1) }).nullable(),
});
export type ManagedPluginCatalogRow = z.infer<
  typeof managedPluginCatalogRowSchema
>;

export const managedPluginCatalogSnapshotSchema = z.object({
  checkedAt: z.number().int().nonnegative(),
  plugins: z.array(managedPluginCatalogRowSchema),
});
export type ManagedPluginCatalogSnapshot = z.infer<
  typeof managedPluginCatalogSnapshotSchema
>;

/**
 * Uniform operation result returned by every managed plugin command so
 * UI can render pending-restart hints and denial diagnostics.
 */
export const managedPluginOperationResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    pluginId: z.string().min(1),
    requiresRestart: z.boolean(),
    version: z.string().min(1).nullable().optional(),
  }),
  z.object({
    error: z.object({
      code: z.enum([
        "denied",
        "invalid_state",
        "not_found",
        "signature",
        "network",
        "hash_mismatch",
        "engine_incompatible",
        "internal_error",
      ]),
      details: z.unknown().optional(),
      diagnosticId: z.string().min(1).optional(),
      message: z.string().min(1),
    }),
    ok: z.literal(false),
  }),
]);
export type ManagedPluginOperationResult = z.infer<
  typeof managedPluginOperationResultSchema
>;
