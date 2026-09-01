/**
 * Canvas 评论可选稳定锚点（Design Mode 主路径不强制）。
 * 作者可在 canvas 源声明 data-pier-comment-id；有 id 时热重载后仍可钉徽标。
 * 无 id 时靠 label/excerpt 进清单与智能体上下文。禁止坐标 pin。
 * Artboard 帧上铺满的包装 id 只稳定「整帧」评论，不把拾取限制在整块画板。
 */
export const CANVAS_COMMENT_ANCHOR_ATTR = "data-pier-comment-id";

/** React / DOM props helper for canvas authors. */
export function canvasCommentAnchorProps(anchorId: string): {
  readonly "data-pier-comment-id": string;
} {
  return { [CANVAS_COMMENT_ANCHOR_ATTR]: anchorId };
}

/** Collect unique non-empty anchor ids under a host element. */
export function collectCanvasCommentAnchorIds(
  root: ParentNode | null | undefined
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!root || typeof root.querySelectorAll !== "function") {
    return ids;
  }
  const nodes = root.querySelectorAll(`[${CANVAS_COMMENT_ANCHOR_ATTR}]`);
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const id = node.getAttribute(CANVAS_COMMENT_ANCHOR_ATTR)?.trim();
    if (id && id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}

/** Find the first element with the given comment anchor id. */
export function findCanvasCommentAnchorElement(
  root: ParentNode | null | undefined,
  anchorId: string
): HTMLElement | null {
  if (!root || typeof root.querySelector !== "function" || !anchorId) {
    return null;
  }
  // CSS.escape for ids with special chars when available.
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(anchorId)
      : anchorId.replaceAll(/["\\]/gu, "\\$&");
  const el = root.querySelector(`[${CANVAS_COMMENT_ANCHOR_ATTR}="${escaped}"]`);
  return el instanceof HTMLElement ? el : null;
}
