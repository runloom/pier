import { z } from "zod";
import { pierCapabilitySchema } from "./permissions.ts";

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

export const pluginManifestSchema = z.object({
  apiVersion: z.literal(1),
  commands: z.array(pluginCommandContributionSchema).default([]),
  description: z.string().min(1).optional(),
  engines: z.object({
    pier: z.string().min(1),
  }),
  homepage: z.string().min(1).optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  panels: z.array(pluginPanelContributionSchema).default([]),
  permissions: z.array(pierCapabilitySchema).default([]),
  publisher: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  source: pluginSourceSchema,
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
  commands: z.array(pluginCommandContributionSchema),
  enabled: z.boolean(),
  id: z.string().min(1),
  manifest: pluginManifestSchema,
  panels: z.array(pluginPanelContributionSchema),
  permissions: z.array(pierCapabilitySchema),
  source: pluginSourceSchema,
  version: z.string().min(1),
});
export type PluginRegistryEntry = z.infer<typeof pluginRegistryEntrySchema>;

export const pluginInspectRequestSchema = z.object({
  id: z.string().min(1),
});
export type PluginInspectRequest = z.infer<typeof pluginInspectRequestSchema>;
