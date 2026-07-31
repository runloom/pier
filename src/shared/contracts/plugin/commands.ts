import { z } from "zod";

/**
 * Managed plugin command schemas. Kept in a separate file to avoid growing
 * `commands.ts` further (see plan File Structure). Imported by `commands.ts`
 * into the PierCommand discriminated union.
 */

const pluginIdParamSchema = z.object({ id: z.string().min(1) });

export const pluginCatalogListCommandSchema = z.object({
  type: z.literal("plugin.catalog.list"),
});
export const pluginCheckUpdatesCommandSchema = z.object({
  type: z.literal("plugin.checkUpdates"),
});
export const pluginInstallCommandSchema = pluginIdParamSchema.extend({
  type: z.literal("plugin.install"),
});
export const pluginUpdateCommandSchema = pluginIdParamSchema.extend({
  type: z.literal("plugin.update"),
});
export const pluginRollbackCommandSchema = pluginIdParamSchema.extend({
  type: z.literal("plugin.rollback"),
  version: z.string().min(1),
});
export const pluginUninstallCommandSchema = pluginIdParamSchema.extend({
  type: z.literal("plugin.uninstall"),
});
export const pluginDevOverrideSetCommandSchema = pluginIdParamSchema.extend({
  path: z.string().min(1),
  type: z.literal("plugin.devOverride.set"),
});
export const pluginDevOverrideClearCommandSchema = pluginIdParamSchema.extend({
  type: z.literal("plugin.devOverride.clear"),
});

export const appRelaunchCommandSchema = z.object({
  type: z.literal("app.relaunch"),
});

export const managedPluginCommandSchemas = [
  pluginCatalogListCommandSchema,
  pluginCheckUpdatesCommandSchema,
  pluginInstallCommandSchema,
  pluginUpdateCommandSchema,
  pluginRollbackCommandSchema,
  pluginUninstallCommandSchema,
  pluginDevOverrideSetCommandSchema,
  pluginDevOverrideClearCommandSchema,
  appRelaunchCommandSchema,
] as const;
