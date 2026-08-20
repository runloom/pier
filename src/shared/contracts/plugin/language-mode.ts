/**
 * Plugin / L1 contribution: editor language identity + highlight strategy.
 * Orthogonal to languageServers (LSP). Requires permission `languageMode:provide`
 * on plugin manifests.
 */

import { z } from "zod";

const extensionSchema = z
  .string()
  .min(2)
  .regex(/^\.[A-Za-z0-9_.+-]+$/u, "extension must start with '.'");

/**
 * Closed highlight presets mapped by the Files editor to CodeMirror packages.
 * Plugins may only reference these ids (no arbitrary parsers).
 */
export const EDITOR_HIGHLIGHT_PRESETS = [
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
  /** Approximate (no dedicated grammar): Astro uses HTML with self-closing tags. */
  "astro",
  /** Approximate (no dedicated grammar): PHP uses clike. */
  "php",
  "dart",
  "lua",
  "dockerfile",
  "r",
  "scala",
  /** Approximate: Elixir uses ruby stream parser. */
  "elixir",
  /** Approximate stream parser (no dedicated CM grammar in L0). */
  "graphql",
  /** Approximate HCL stream parser (no dedicated CM grammar in L0). */
  "terraform",
] as const;

export const editorHighlightPresetSchema = z.enum(EDITOR_HIGHLIGHT_PRESETS);
export type EditorHighlightPreset = z.infer<typeof editorHighlightPresetSchema>;

/**
 * Declarative language mode (badge + syntax highlight strategy).
 * Runtime source id is `{pluginId}:{id}` for plugins, or `custom:{id}` for L1.
 */
export const pluginLanguageModeContributionSchema = z
  .object({
    displayName: z.string().min(1),
    extensions: z.array(extensionSchema).min(1),
    /**
     * Highlight strategy. Defaults to text when omitted.
     */
    highlight: editorHighlightPresetSchema.default("text"),
    id: z.string().min(1),
    /**
     * LSP / editor language id (didOpen, badges when no separate label).
     * Defaults to contribution `id` when omitted at materialization.
     */
    languageId: z.string().min(1).optional(),
    priority: z.number().int().min(0).max(100).default(70),
  })
  .strict();

export type PluginLanguageModeContribution = z.infer<
  typeof pluginLanguageModeContributionSchema
>;
