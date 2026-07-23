import type {
  GitReviewFileStatus,
  GitReviewGroup,
} from "@shared/contracts/git-review.ts";

export interface GitReviewTreeFileRef {
  entryKey: string;
  group: GitReviewGroup;
  path: string;
  sectionKey: string;
  status: GitReviewFileStatus;
}

const REVIEW_TREE_NODE_ID_PREFIX = "section:";

export function makeReviewTreeNodeId(sectionKey: string): string {
  return `${REVIEW_TREE_NODE_ID_PREFIX}${sectionKey}`;
}

export function parseReviewTreeNodeId(
  id: string
): { sectionKey: string } | null {
  if (!id.startsWith(REVIEW_TREE_NODE_ID_PREFIX)) {
    return null;
  }
  const sectionKey = id.slice(REVIEW_TREE_NODE_ID_PREFIX.length);
  if (sectionKey.length === 0) {
    return null;
  }
  return { sectionKey };
}
