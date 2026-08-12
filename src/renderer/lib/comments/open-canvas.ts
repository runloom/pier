/**
 * 宿主打开 Canvas 文件预览（文件级 / 节点级评论跳转）。
 */
import type { PanelContext } from "@shared/contracts/panel.ts";
import { openFilesDiskPath } from "@/lib/files/open-disk-file-panel.ts";

export function openCanvasForComment(input: {
  readonly anchorId?: string;
  readonly context: PanelContext;
  readonly path: string;
  readonly root: string;
}): boolean {
  const title = input.path.split("/").filter(Boolean).at(-1) ?? input.path;
  return openFilesDiskPath({
    context: input.context,
    path: input.path,
    preferPreview: true,
    root: input.root,
    title,
    ...(input.anchorId === undefined
      ? {}
      : { canvasRevealAnchor: input.anchorId }),
  });
}
