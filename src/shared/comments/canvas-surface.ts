/**
 * Canvas 评论投影表面（纯数据，renderer / plugin / processable 共用）。
 */
export interface CanvasCommentSurface {
  /** 运行时 DOM 中仍存在的声明式节点 id；文件级评论忽略。 */
  readonly anchorIds: ReadonlySet<string>;
  readonly filePresent: boolean;
  readonly kind: "canvas";
}

export function buildCanvasCommentSurface(input: {
  readonly anchorIds?: readonly string[] | ReadonlySet<string>;
  readonly filePresent: boolean;
}): CanvasCommentSurface {
  const anchorIds = new Set<string>();
  if (input.anchorIds) {
    for (const id of input.anchorIds) {
      if (id.length > 0) {
        anchorIds.add(id);
      }
    }
  }
  return {
    anchorIds,
    filePresent: input.filePresent,
    kind: "canvas",
  };
}
