/**
 * Wrap IR block trees with optional comment chrome.
 */
import { Fragment, type ReactNode } from "react";
import type { MarkdownBlock } from "../ir.ts";
import type { MarkdownIrCommentsChrome } from "./ir-types.ts";
import { MarkdownCommentBlockShell } from "./preview-block.tsx";
import { blockCommentKey, contentHashForBlock } from "./target.ts";

export function wrapBlocksWithComments(
  blocks: readonly MarkdownBlock[],
  renderBlock: (block: MarkdownBlock) => ReactNode,
  comments: MarkdownIrCommentsChrome | undefined
): ReactNode[] {
  return blocks.map((block) => {
    const content = renderBlock(block);
    const key = `${block.kind}-${block.range.startOffset}-${block.range.endOffset}`;
    if (!comments) {
      return <Fragment key={key}>{content}</Fragment>;
    }
    const blockKey = blockCommentKey(block);
    const contentHash = contentHashForBlock(block);
    // Only commentable blocks get chrome (hashable plain text).
    if (contentHash === null) {
      return <Fragment key={key}>{content}</Fragment>;
    }
    const located = comments.locatedByBlockKey.get(blockKey);
    const threads = located?.threads ?? [];
    const draftId = comments.draftBlockKey === contentHash ? contentHash : null;
    return (
      <MarkdownCommentBlockShell
        addCommentLabel={comments.addCommentLabel}
        blockKey={blockKey}
        draftId={draftId}
        handlers={comments.handlers}
        key={key}
        labels={comments.labels}
        onOpenDraft={() => comments.onOpenDraft(blockKey)}
        threads={threads}
      >
        {content}
      </MarkdownCommentBlockShell>
    );
  });
}
