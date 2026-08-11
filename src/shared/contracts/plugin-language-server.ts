import { z } from "zod";

const lspExtensionSchema = z
  .string()
  .min(2)
  .regex(/^\.[A-Za-z0-9_.+-]+$/u, "extension must start with '.'");

/**
 * Declarative language-server contribution (PATH / absolute command).
 * Runtime provider id is `{pluginId}:{id}`. Requires permission `lsp:provide`.
 */
export const pluginLanguageServerContributionSchema = z
  .object({
    args: z.array(z.string()).default([]),
    command: z.string().min(1),
    commandCandidates: z.array(z.string().min(1)).optional(),
    displayName: z.string().min(1),
    extensions: z.array(lspExtensionSchema).min(1),
    id: z.string().min(1),
    /**
     * User-facing install command when the binary is missing from PATH.
     * Owned by the language plugin — Files only displays it.
     */
    installCommand: z.string().min(1).optional(),
    languageIdByExtension: z.record(z.string(), z.string().min(1)).optional(),
    languageIds: z.array(z.string().min(1)).min(1),
    priority: z.number().int().min(0).max(100).default(70),
    rootMarkers: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type PluginLanguageServerContribution = z.infer<
  typeof pluginLanguageServerContributionSchema
>;
