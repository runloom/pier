export interface PdfLinkAnnotationLike {
  dest?: unknown;
  rect?: readonly number[] | undefined;
  subtype?: string | undefined;
  url?: string | undefined;
}

export type PdfLinkTarget =
  | {
      kind: "external";
      rect: readonly number[];
      url: string;
    }
  | {
      dest: unknown;
      kind: "internal";
      rect: readonly number[];
    };

function allowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

function annotationRect(
  rect: readonly number[] | undefined
): readonly number[] {
  return rect && rect.length >= 4 ? rect : [];
}

/**
 * Keep only PDF link annotations that can be opened safely. Internal
 * destinations stay raw here; page resolution is async and lives in page.tsx.
 */
export function pdfLinkTargets(
  annotations: readonly PdfLinkAnnotationLike[]
): PdfLinkTarget[] {
  const targets: PdfLinkTarget[] = [];
  for (const annotation of annotations) {
    if (annotation.subtype !== "Link") {
      continue;
    }
    const rect = annotationRect(annotation.rect);
    if (typeof annotation.url === "string" && annotation.url.length > 0) {
      if (allowedExternalUrl(annotation.url)) {
        targets.push({ kind: "external", rect, url: annotation.url });
      }
      continue;
    }
    if (annotation.dest !== undefined && annotation.dest !== null) {
      targets.push({
        dest: annotation.dest,
        kind: "internal",
        rect,
      });
    }
  }
  return targets;
}

export interface PdfPageIndexResolver {
  getDestination(id: string): Promise<unknown>;
  getPageIndex(ref: unknown): Promise<number>;
}

/** Resolve an internal destination to a 0-based page index. */
export async function resolvePdfPageIndex(
  pdf: PdfPageIndexResolver,
  dest: unknown
): Promise<number | null> {
  try {
    let destination: unknown = dest;
    if (typeof dest === "string") {
      destination = await pdf.getDestination(dest);
    }
    if (!Array.isArray(destination) || destination.length === 0) {
      return null;
    }
    return await pdf.getPageIndex(destination[0]);
  } catch {
    // One malformed link destination must not fail the whole page render.
    return null;
  }
}
