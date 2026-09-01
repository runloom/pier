import { z } from "zod";

/**
 * Pier canvas file metadata (P-track product semantics).
 *
 * Industry alignment (Storybook Canvas/Docs + Figma Components page):
 * - composition — design canvas / scheme frames on an artboard (Figma Frame / Playroom)
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

const PIER_CANVAS_INVOKE_RE =
  /(^|[\s])(\/skills\s+pier-canvas|\/skill:pier-canvas|[/$]pier-canvas)(?=$|[\s])/u;

/**
 * Append `locale=` to a pier-canvas invoke if the host has not already set one.
 * The host does not infer `mode` / `recipe` / `content` — the agent does that
 * from the skill.
 */
export function annotatePierCanvasInvokeLocale(
  text: string,
  locale: string
): string {
  const tag = locale.trim();
  if (!tag || /\blocale=/.test(text)) {
    return text;
  }
  return text.replace(PIER_CANVAS_INVOKE_RE, `$1$2 locale=${tag}`);
}

/** `labels[id][locale] ?? labels[id].en` — extra locales are optional. */
export function resolveCanvasNavLabel(
  labels: Readonly<Record<string, Readonly<Record<string, string>>>>,
  viewId: string,
  locale: string,
  fallback = "en"
): string | undefined {
  const row = labels[viewId];
  if (!row) {
    return;
  }
  return row[locale] ?? row[fallback];
}
