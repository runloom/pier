import { z } from "zod";
import { pierCapabilitySchema } from "./permissions.ts";

export const GIT_PLUGIN_ID = "pier.git";

export const pluginSourceKindSchema = z.enum([
  "builtin",
  "local",
  "git",
  "registry",
]);
export type PluginSourceKind = z.infer<typeof pluginSourceKindSchema>;

export const pluginSourceSchema = z.object({
  integrity: z.string().min(1).optional(),
  kind: pluginSourceKindSchema,
  url: z.string().min(1).optional(),
});
export type PluginSource = z.infer<typeof pluginSourceSchema>;

const pluginLocaleCodeSchema = z.string().min(1);

export const pluginLocalizedContributionSchema = z.object({
  aliases: z.array(z.string().min(1)).optional(),
  description: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
});
export type PluginLocalizedContribution = z.infer<
  typeof pluginLocalizedContributionSchema
>;

export const pluginLocalizedCommandContributionSchema =
  pluginLocalizedContributionSchema.extend({
    category: z.string().min(1).optional(),
  });
export type PluginLocalizedCommandContribution = z.infer<
  typeof pluginLocalizedCommandContributionSchema
>;

export const pluginLocaleMessagesSchema = z.object({
  commands: z
    .record(z.string().min(1), pluginLocalizedCommandContributionSchema)
    .optional(),
  description: z.string().min(1).optional(),
  messages: z.record(z.string().min(1), z.string().min(1)).optional(),
  name: z.string().min(1).optional(),
  panels: z
    .record(z.string().min(1), pluginLocalizedContributionSchema)
    .optional(),
  terminalStatusItems: z
    .record(z.string().min(1), pluginLocalizedContributionSchema)
    .optional(),
});
export type PluginLocaleMessages = z.infer<typeof pluginLocaleMessagesSchema>;

export const pluginLocalizationSchema = z.object({
  defaultLocale: pluginLocaleCodeSchema,
  files: z.record(pluginLocaleCodeSchema, z.string().min(1)).default({}),
  locales: z.array(pluginLocaleCodeSchema).default([]),
});
export type PluginLocalization = z.infer<typeof pluginLocalizationSchema>;

export const pluginCommandContributionSchema = z.object({
  category: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  id: z.string().min(1),
  permissions: z.array(pierCapabilitySchema).default([]),
  title: z.string().min(1),
});
export type PluginCommandContribution = z.infer<
  typeof pluginCommandContributionSchema
>;

export const pluginPanelContributionSchema = z.object({
  component: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  id: z.string().min(1),
  permissions: z.array(pierCapabilitySchema).default([]),
  title: z.string().min(1),
});
export type PluginPanelContribution = z.infer<
  typeof pluginPanelContributionSchema
>;

export const terminalStatusItemAlignmentSchema = z.enum(["left", "right"]);
export type TerminalStatusItemAlignment = z.infer<
  typeof terminalStatusItemAlignmentSchema
>;

export const pluginTerminalStatusItemContributionSchema = z.object({
  /**
   * 状态栏左右分组,缺省 "left"。与 order 的组合语义(设计文档 §3.3,勿改):
   * 同侧内 order 越小越靠外侧 —— left 组 order 小 → 靠左;right 组 order 小 → 靠右。
   * 同 order 按 id 字典序,字典序小者更靠外侧。
   * 默认值不在 schema 注入,统一由 renderer 合并层给(用户覆盖 ?? manifest ?? 默认)。
   */
  alignment: terminalStatusItemAlignmentSchema.optional(),
  description: z.string().min(1).optional(),
  id: z.string().min(1),
  /** 同侧排序权重,缺省 0。语义见 alignment 注释。 */
  order: z.number().optional(),
  permissions: z.array(pierCapabilitySchema).default([]),
  title: z.string().min(1),
});
export type PluginTerminalStatusItemContribution = z.infer<
  typeof pluginTerminalStatusItemContributionSchema
>;

export const pluginManifestSchema = z.object({
  apiVersion: z.literal(1),
  commands: z.array(pluginCommandContributionSchema).default([]),
  description: z.string().min(1).optional(),
  engines: z.object({
    pier: z.string().min(1),
  }),
  homepage: z.string().min(1).optional(),
  id: z.string().min(1),
  localization: pluginLocalizationSchema.optional(),
  locales: z
    .record(pluginLocaleCodeSchema, pluginLocaleMessagesSchema)
    .optional(),
  name: z.string().min(1),
  panels: z.array(pluginPanelContributionSchema).default([]),
  permissions: z.array(pierCapabilitySchema).default([]),
  publisher: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  source: pluginSourceSchema,
  terminalStatusItems: z
    .array(pluginTerminalStatusItemContributionSchema)
    .default([]),
  version: z.string().min(1),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const pluginRuntimeStateSchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});
export type PluginRuntimeState = z.infer<typeof pluginRuntimeStateSchema>;

export const pluginRegistryStateSchema = z.object({
  plugins: z.record(z.string(), pluginRuntimeStateSchema),
  version: z.literal(1),
});
export type PluginRegistryState = z.infer<typeof pluginRegistryStateSchema>;

export const pluginRegistryEntrySchema = z.object({
  enabled: z.boolean(),
  effectivePermissions: z.array(pierCapabilitySchema),
  manifest: pluginManifestSchema,
  runtime: z.object({
    canToggle: z.boolean(),
    disabledReason: z.string().min(1).optional(),
    enabled: z.boolean(),
    kind: z.enum(["builtin", "manifest-only"]),
  }),
});
export type PluginRegistryEntry = z.infer<typeof pluginRegistryEntrySchema>;

export const pluginRegistryDiagnosticSourceSchema = z.object({
  integrity: z.string().min(1).optional(),
  kind: pluginSourceKindSchema,
  path: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
});
export type PluginRegistryDiagnosticSource = z.infer<
  typeof pluginRegistryDiagnosticSourceSchema
>;

export const pluginRegistryDiagnosticSchema = z.object({
  code: z.enum(["invalid_manifest", "unsupported"]),
  message: z.string().min(1),
  source: pluginRegistryDiagnosticSourceSchema,
});
export type PluginRegistryDiagnostic = z.infer<
  typeof pluginRegistryDiagnosticSchema
>;

export const pluginRegistryListResultSchema = z.object({
  diagnostics: z.array(pluginRegistryDiagnosticSchema),
  entries: z.array(pluginRegistryEntrySchema),
});
export type PluginRegistryListResult = z.infer<
  typeof pluginRegistryListResultSchema
>;

export const pluginInspectRequestSchema = z.object({
  id: z.string().min(1),
});
export type PluginInspectRequest = z.infer<typeof pluginInspectRequestSchema>;
