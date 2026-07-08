import { z } from "zod";
import { pluginMissionControlWidgetContributionSchema } from "./mission-control.ts";
import { pierCapabilitySchema } from "./permissions.ts";

export const pluginSourceKindSchema = z.enum([
  "builtin",
  "local",
  "git",
  "registry",
  "official",
  "devOverride",
]);
export type PluginSourceKind = z.infer<typeof pluginSourceKindSchema>;

export const pluginSourceSchema = z.object({
  integrity: z.string().min(1).optional(),
  kind: pluginSourceKindSchema,
  url: z.string().min(1).optional(),
});
export type PluginSource = z.infer<typeof pluginSourceSchema>;

export const pluginRuntimePolicySchema = z.object({
  reloadPolicy: z.enum(["restart", "hot"]).optional(),
});
export type PluginRuntimePolicy = z.infer<typeof pluginRuntimePolicySchema>;

export const pluginLocaleCodeSchema = z.string().min(1);

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

export const pluginLocalizedSettingSchema = z.object({
  description: z.string().min(1).optional(),
  enumDescriptions: z.array(z.string().min(1)).optional(),
  label: z.string().min(1).optional(),
  placeholder: z.string().min(1).optional(),
});
export type PluginLocalizedSetting = z.infer<
  typeof pluginLocalizedSettingSchema
>;

export const pluginLocaleMessagesSchema = z.object({
  commands: z
    .record(z.string().min(1), pluginLocalizedCommandContributionSchema)
    .optional(),
  description: z.string().min(1).optional(),
  messages: z.record(z.string().min(1), z.string().min(1)).optional(),
  missionControlWidgets: z
    .record(z.string().min(1), pluginLocalizedContributionSchema)
    .optional(),
  name: z.string().min(1).optional(),
  panels: z
    .record(z.string().min(1), pluginLocalizedContributionSchema)
    .optional(),
  settings: z
    .record(z.string().min(1), pluginLocalizedSettingSchema)
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

const pluginConfigurationPropertyBaseSchema = z.object({
  default: z.union([z.string(), z.number(), z.boolean()]),
  description: z.string().min(1).optional(),
  enum: z.array(z.string().min(1)).min(1).optional(),
  enumDescriptions: z.array(z.string().min(1)).optional(),
  maximum: z.number().optional(),
  minimum: z.number().optional(),
  multiline: z.boolean().optional(),
  order: z.number().optional(),
  placeholder: z.string().min(1).optional(),
  resettable: z.boolean().optional(),
  type: z.enum(["string", "number", "boolean"]),
});

type PluginConfigurationPropertyCandidate = z.infer<
  typeof pluginConfigurationPropertyBaseSchema
>;
type PluginConfigurationPropertyIssuePath =
  | "default"
  | "enum"
  | "enumDescriptions"
  | "minimum"
  | "multiline"
  | "placeholder";
type AddConfigurationPropertyIssue = (
  path: PluginConfigurationPropertyIssuePath,
  message: string
) => void;

function validateConfigurationPropertyTypes(
  property: PluginConfigurationPropertyCandidate,
  addIssue: AddConfigurationPropertyIssue
): void {
  if (typeof property.default !== property.type) {
    addIssue("default", `default must match type "${property.type}"`);
  }
  if (property.enum && property.type !== "string") {
    addIssue("enum", 'enum is only allowed with type "string"');
  }
  if (property.multiline && property.type !== "string") {
    addIssue("multiline", 'multiline is only allowed with type "string"');
  }
  if (property.placeholder && property.type !== "string") {
    addIssue("placeholder", 'placeholder is only allowed with type "string"');
  }
  if (
    (property.minimum !== undefined || property.maximum !== undefined) &&
    property.type !== "number"
  ) {
    addIssue("minimum", 'minimum/maximum are only allowed with type "number"');
  }
}

function validateConfigurationPropertyEnum(
  property: PluginConfigurationPropertyCandidate,
  addIssue: AddConfigurationPropertyIssue
): void {
  if (
    property.enum &&
    typeof property.default === "string" &&
    !property.enum.includes(property.default)
  ) {
    addIssue("default", "default must be a member of enum");
  }
  if (property.enumDescriptions && !property.enum) {
    addIssue("enumDescriptions", "enumDescriptions requires enum");
  }
  if (
    property.enumDescriptions &&
    property.enum &&
    property.enumDescriptions.length !== property.enum.length
  ) {
    addIssue(
      "enumDescriptions",
      "enumDescriptions must have the same length as enum"
    );
  }
}

function validateConfigurationPropertyRange(
  property: PluginConfigurationPropertyCandidate,
  addIssue: AddConfigurationPropertyIssue
): void {
  if (
    property.minimum !== undefined &&
    property.maximum !== undefined &&
    property.minimum > property.maximum
  ) {
    addIssue("minimum", "minimum must not be greater than maximum");
  }
  if (
    property.type === "number" &&
    typeof property.default === "number" &&
    property.minimum !== undefined &&
    property.default < property.minimum
  ) {
    addIssue("default", "default must be greater than or equal to minimum");
  }
  if (
    property.type === "number" &&
    typeof property.default === "number" &&
    property.maximum !== undefined &&
    property.default > property.maximum
  ) {
    addIssue("default", "default must be less than or equal to maximum");
  }
}

export const pluginConfigurationPropertySchema =
  pluginConfigurationPropertyBaseSchema.superRefine((property, ctx) => {
    const addIssue: AddConfigurationPropertyIssue = (path, message) => {
      ctx.addIssue({ code: "custom", message, path: [path] });
    };
    validateConfigurationPropertyTypes(property, addIssue);
    validateConfigurationPropertyEnum(property, addIssue);
    validateConfigurationPropertyRange(property, addIssue);
  });
export type PluginConfigurationProperty = z.infer<
  typeof pluginConfigurationPropertySchema
>;

export const pluginConfigurationSchema = z.object({
  properties: z.record(z.string().min(1), pluginConfigurationPropertySchema),
  title: z.string().min(1).optional(),
});
export type PluginConfiguration = z.infer<typeof pluginConfigurationSchema>;

export const pluginManifestSchema = z
  .object({
    apiVersion: z.literal(1),
    commands: z.array(pluginCommandContributionSchema).default([]),
    configuration: pluginConfigurationSchema.optional(),
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
    missionControlWidgets: z
      .array(pluginMissionControlWidgetContributionSchema)
      .default([]),
    name: z.string().min(1),
    panels: z.array(pluginPanelContributionSchema).default([]),
    permissions: z.array(pierCapabilitySchema).default([]),
    publisher: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    runtime: pluginRuntimePolicySchema.optional(),
    source: pluginSourceSchema,
    terminalStatusItems: z
      .array(pluginTerminalStatusItemContributionSchema)
      .default([]),
    version: z.string().min(1),
  })
  .superRefine((manifest, ctx) => {
    if (!manifest.configuration) {
      return;
    }
    const prefix = `${manifest.id}.`;
    for (const key of Object.keys(manifest.configuration.properties)) {
      if (!(key.startsWith(prefix) && key.length > prefix.length)) {
        ctx.addIssue({
          code: "custom",
          message: `configuration key must start with "${prefix}": ${key}`,
          path: ["configuration", "properties", key],
        });
      }
    }
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
    kind: z.enum(["builtin", "manifest-only", "external"]),
    rendererEntryUrl: z.string().min(1).optional(),
    sourceRevision: z.string().min(1).optional(),
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
