import type { ReactNode } from "react";
import type { MarkdownHeadingSummary, MarkdownSourceRange } from "../ir.ts";
import { convertHtmlRootNodes } from "./dom.tsx";
import { headingIdsInRange } from "./headings.ts";
import { sanitizeMarkdownHtml } from "./sanitizer.ts";
import type { MarkdownHtmlRenderEnv } from "./types.ts";

export function renderMarkdownHtmlBlock(
  html: string,
  env: Omit<MarkdownHtmlRenderEnv, "headingIds"> & {
    headings: readonly MarkdownHeadingSummary[];
    range: MarkdownSourceRange;
  }
): ReactNode {
  const fragment = sanitizeMarkdownHtml(html);
  if (!fragment.hasChildNodes()) return null;
  return convertHtmlRootNodes(fragment, {
    ...env,
    headingIds: headingIdsInRange(env.headings, env.range),
  });
}
