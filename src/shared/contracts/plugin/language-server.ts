import { z } from "zod";

const lspExtensionSchema = z
  .string()
  .min(2)
  .regex(/^\.[A-Za-z0-9_.+-]+$/u, "extension must start with '.'");

/**
 * Declarative language-server contribution (PATH / absolute command).
 * Runtime provider id is `{pluginId}:{id}`. Requires permission `lsp:provide`.
 */
const launchCandidateSchema = z
  .object({
    args: z.array(z.string()).default([]),
    command: z.string().min(1),
  })
  .strict();

export const pluginLanguageServerContributionSchema = z
  .object({
    args: z.array(z.string()).default([]),
    command: z.string().min(1),
    commandCandidates: z.array(z.string().min(1)).optional(),
    /**
     * Ordered launch attempts with per-candidate args (e.g. sourcekit-lsp, then
     * `xcrun sourcekit-lsp`). When set, tried before plain commandCandidates.
     */
    launchCandidates: z.array(launchCandidateSchema).min(1).optional(),
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
    /**
     * Match paths by basename (case-insensitive), e.g. `Dockerfile`,
     * `dockerfile.*`. Used with extensions for files without a normal ext.
     */
    basenameMatchers: z.array(z.string().min(1)).optional(),
    priority: z.number().int().min(0).max(100).default(70),
    rootMarkers: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type PluginLanguageServerContribution = z.infer<
  typeof pluginLanguageServerContributionSchema
>;
