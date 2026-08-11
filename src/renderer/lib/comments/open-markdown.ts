/**
 * 宿主打开 Markdown 文件预览并定位评论锚点。
 */
import type { PanelContext } from "@shared/contracts/panel.ts";
import { openFilesDiskPath } from "@/lib/files/open-disk-file-panel.ts";

export function openMarkdownForComment(input: {
  readonly context: PanelContext;
  readonly headingId?: string;
  readonly path: string;
  readonly root: string;
  readonly startLine?: number;
}): boolean {
  const title = input.path.split("/").filter(Boolean).at(-1) ?? input.path;
  return openFilesDiskPath({
    context: input.context,
    path: input.path,
    root: input.root,
    title,
    ...(input.headingId === undefined
      ? {}
      : { markdownAnchor: input.headingId }),
    preferPreview: true,
    ...(input.startLine === undefined ? {} : { line: input.startLine }),
  });
}
