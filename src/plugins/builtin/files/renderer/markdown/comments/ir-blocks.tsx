/**
 * Wrap IR block trees with optional comment chrome.
 */
import { Fragment, type ReactNode } from "react";
import type { MarkdownBlock } from "../ir.ts";
import type { MarkdownIrCommentsChrome } from "./ir-types.ts";
import { MarkdownCommentBlockShell } from "./preview-block.tsx";
import {
  blockCommentKey,
  contentHashForBlock,
  markdownCommentMarkerIndexes,
} from "./target.ts";

export function wrapBlocksWithComments(
  blocks: readonly MarkdownBlock[],
  renderBlock: (block: MarkdownBlock) => ReactNode,
  comments: MarkdownIrCommentsChrome | undefined
): ReactNode[] {
  const markerIndexes = comments
    ? markdownCommentMarkerIndexes(blocks, comments.locatedByBlockKey)
    : null;
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
        markerIndex={markerIndexes?.get(blockKey) ?? 0}
        onOpenDraft={() => comments.onOpenDraft(blockKey)}
        requestOpenBlockKey={comments.requestOpenBlockKey}
        requestOpenNonce={comments.requestOpenNonce}
        threads={threads}
        viewCommentLabel={comments.viewCommentLabel}
        viewCommentsLabel={comments.viewCommentsLabel}
      >
        {content}
      </MarkdownCommentBlockShell>
    );
  });
}
