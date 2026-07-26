import { z } from "zod";

/**
 * Pier canvas file metadata (P-track product semantics).
 *
 * Industry alignment (Storybook Canvas/Docs + Figma Components page):
 * - composition — design canvas / scheme Frame (Playroom-like)
 * - docs — visual documentation (Storybook Docs-like)
 * - kit — global component catalog (Figma Components page)
 *
 * C-track Live Modules ignores kind; Viewer/Library may surface it.
 * Authors export: `export const canvas = { kind, title, ... }`
 */
export const pierCanvasKindSchema = z.enum(["composition", "docs", "kit"]);

export type PierCanvasKind = z.infer<typeof pierCanvasKindSchema>;

export const pierCanvasMetaSchema = z
  .object({
    kind: pierCanvasKindSchema,
    title: z.string().min(1).max(128),
    description: z.string().max(512).optional(),
  })
  .strict();

export type PierCanvasMeta = z.infer<typeof pierCanvasMetaSchema>;

export function parsePierCanvasMeta(value: unknown): PierCanvasMeta | null {
  const parsed = pierCanvasMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
