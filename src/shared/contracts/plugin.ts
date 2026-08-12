import { z } from "zod";
import { pierCapabilitySchema } from "./permissions.ts";
import { pluginConfigurationSchema } from "./plugin/configuration.ts";
import { pluginLanguageModeContributionSchema } from "./plugin/language-mode.ts";
import { pluginLanguageServerContributionSchema } from "./plugin/language-server.ts";
import { pluginWorkbenchWidgetContributionSchema } from "./workbench.ts";

export type {
  EditorHighlightPreset,
  PluginLanguageModeContribution,
} from "./plugin/language-mode.ts";
export {
  EDITOR_HIGHLIGHT_PRESETS,
  editorHighlightPresetSchema,
  pluginLanguageModeContributionSchema,
} from "./plugin/language-mode.ts";
export type { PluginLanguageServerContribution } from "./plugin/language-server.ts";
export { pluginLanguageServerContributionSchema } from "./plugin/language-server.ts";

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

export const pluginLocalizedSettingsPageSchema = z.object({
  title: z.string().min(1).optional(),
});
export type PluginLocalizedSettingsPage = z.infer<
  typeof pluginLocalizedSettingsPageSchema
>;

/**
 * 只读兼容 apiVersion 1 早期包中的旧贡献键；解析结果始终只暴露新键。
 * 新清单、运行时快照和再次序列化不得写回旧键。
 */
export function normalizeLegacyWorkbenchContributionKey(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const record = raw as Record<string, unknown>;
  const legacyKey = "missionControlWidgets";
  if (
    record.workbenchWidgets !== undefined ||
    record[legacyKey] === undefined
  ) {
    return raw;
  }
  const { [legacyKey]: legacyWidgets, ...rest } = record;
  return { ...rest, workbenchWidgets: legacyWidgets };
}

const pluginLocaleMessagesObjectSchema = z.object({
  commands: z
    .record(z.string().min(1), pluginLocalizedCommandContributionSchema)
    .optional(),
  description: z.string().min(1).optional(),
  messages: z.record(z.string().min(1), z.string().min(1)).optional(),
  workbenchWidgets: z
    .record(z.string().min(1), pluginLocalizedContributionSchema)
    .optional(),
  name: z.string().min(1).optional(),
  panels: z
    .record(z.string().min(1), pluginLocalizedContributionSchema)
    .optional(),
  settings: z
    .record(z.string().min(1), pluginLocalizedSettingSchema)
    .optional(),
  settingsPages: z
    .record(z.string().min(1), pluginLocalizedSettingsPageSchema)
    .optional(),
  terminalStatusItems: z
    .record(z.string().min(1), pluginLocalizedContributionSchema)
    .optional(),
});
export const pluginLocaleMessagesSchema = z.preprocess(
  normalizeLegacyWorkbenchContributionKey,
  pluginLocaleMessagesObjectSchema
);
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

export const pluginGroupContentContributionSchema = z.object({
  description: z.string().min(1).optional(),
  id: z.string().min(1),
  title: z.string().min(1),
});
export type PluginGroupContentContribution = z.infer<
  typeof pluginGroupContentContributionSchema
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
  /**
   * 窄屏整项隐藏优先级：越大越先藏。缺省由宿主默认 25。
   * 与 order（阅读顺序）独立。
   */
  overflowPriority: z.number().optional(),
  /** true 时永不因溢出整项隐藏（通常分支身份）；仍可能被 CSS 截断。 */
  overflowPinned: z.boolean().optional(),
  permissions: z.array(pierCapabilitySchema).default([]),
  title: z.string().min(1),
});
export type PluginTerminalStatusItemContribution = z.infer<
  typeof pluginTerminalStatusItemContributionSchema
>;

export const pluginSettingsPageContributionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
});
export type PluginSettingsPageContribution = z.infer<
  typeof pluginSettingsPageContributionSchema
>;

export {
  type PluginConfiguration,
  type PluginConfigurationProperty,
  pluginConfigurationPropertySchema,
  pluginConfigurationSchema,
} from "./plugin/configuration.ts";

const pluginManifestObjectSchema = z
  .object({
    apiVersion: z.literal(1),
    commands: z.array(pluginCommandContributionSchema).default([]),
    configuration: pluginConfigurationSchema.optional(),
    description: z.string().min(1).optional(),
    engines: z.object({
      pier: z.string().min(1),
    }),
    homepage: z.string().min(1).optional(),
    groupContent: z.array(pluginGroupContentContributionSchema).optional(),
    id: z.string().min(1),
    localization: pluginLocalizationSchema.optional(),
    locales: z
      .record(pluginLocaleCodeSchema, pluginLocaleMessagesSchema)
      .optional(),
    workbenchWidgets: z
      .array(pluginWorkbenchWidgetContributionSchema)
      .default([]),
    name: z.string().min(1),
    /**
     * Optional so hand-written manifests/tests need not list an empty array.
     * Runtime readers must use `manifest.languageServers ?? []`.
     */
    languageServers: z.array(pluginLanguageServerContributionSchema).optional(),
    /**
     * Editor language modes (extensions → badge + highlight preset).
     * Runtime readers must use `manifest.languageModes ?? []`.
     */
    languageModes: z.array(pluginLanguageModeContributionSchema).optional(),
    panels: z.array(pluginPanelContributionSchema).default([]),

    permissions: z.array(pierCapabilitySchema).default([]),
    settingsPages: z
      .array(pluginSettingsPageContributionSchema)
      .max(1)
      .default([]),
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
    const prefix = `${manifest.id}.`;
    const languageServers = manifest.languageServers ?? [];
    if (
      languageServers.length > 0 &&
      !manifest.permissions.includes("lsp:provide")
    ) {
      ctx.addIssue({
        code: "custom",
        message: 'languageServers require permissions to include "lsp:provide"',
        path: ["languageServers"],
      });
    }
    const languageServerIds = new Set<string>();
    for (const [index, contribution] of languageServers.entries()) {
      if (languageServerIds.has(contribution.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate languageServer id: ${contribution.id}`,
          path: ["languageServers", index, "id"],
        });
      }
      languageServerIds.add(contribution.id);
    }
    const languageModes = manifest.languageModes ?? [];
    if (
      languageModes.length > 0 &&
      !manifest.permissions.includes("languageMode:provide")
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          'languageModes require permissions to include "languageMode:provide"',
        path: ["languageModes"],
      });
    }
    const languageModeIds = new Set<string>();
    for (const [index, contribution] of languageModes.entries()) {
      if (languageModeIds.has(contribution.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate languageMode id: ${contribution.id}`,
          path: ["languageModes", index, "id"],
        });
      }
      languageModeIds.add(contribution.id);
    }
    if (manifest.configuration) {
      for (const key of Object.keys(manifest.configuration.properties)) {
        if (!(key.startsWith(prefix) && key.length > prefix.length)) {
          ctx.addIssue({
            code: "custom",
            message: `configuration key must start with "${prefix}": ${key}`,
            path: ["configuration", "properties", key],
          });
        }
      }
    }
    for (const [index, contribution] of (
      manifest.groupContent ?? []
    ).entries()) {
      if (!contribution.id.startsWith(prefix)) {
        ctx.addIssue({
          code: "custom",
          message: `groupContent id must start with "${prefix}": ${contribution.id}`,
          path: ["groupContent", index, "id"],
        });
      }
    }
  });
export const pluginManifestSchema = z.preprocess(
  normalizeLegacyWorkbenchContributionKey,
  pluginManifestObjectSchema
);
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
