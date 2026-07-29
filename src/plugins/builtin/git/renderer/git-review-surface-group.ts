import {
  GIT_REVIEW_GROUP_ORDER,
  type GitReviewGroup,
} from "@shared/contracts/git-review.ts";
import type { GitReviewReadingSurface } from "./git-review-reading-surface.ts";

export type GitReviewUncommittedGroup = Extract<
  GitReviewGroup,
  "conflict" | "staged" | "unstaged"
>;

function definePresentationGroupOrder<
  const Order extends readonly GitReviewGroup[],
>(
  order: Order &
    (GitReviewGroup extends Order[number]
      ? unknown
      : { readonly missingGitReviewGroups: never })
): Order {
  const protocolGroups = new Set<GitReviewGroup>(GIT_REVIEW_GROUP_ORDER);
  const presentationGroups = new Set<GitReviewGroup>(order);
  if (
    presentationGroups.size !== order.length ||
    presentationGroups.size !== protocolGroups.size ||
    GIT_REVIEW_GROUP_ORDER.some((group) => !presentationGroups.has(group))
  ) {
    throw new Error(
      "Git review presentation groups must exactly cover the protocol groups"
    );
  }
  return order;
}

/** 目录树、页签、正文与会话共同使用的产品展示顺序。 */
export const GIT_REVIEW_PRESENTATION_GROUP_ORDER = definePresentationGroupOrder(
  ["conflict", "staged", "unstaged", "committed"] as const
);

/** 阅读面对应的唯一索引分组。 */
export function reviewGroupsForSurface(
  surface: GitReviewReadingSurface
): readonly GitReviewGroup[] {
  return surface === "index" ? ["unstaged"] : [surface];
}

export function reviewSurfaceForGroup(
  group: GitReviewGroup
): GitReviewReadingSurface {
  if (group === "unstaged") {
    return "index";
  }
  return group;
}

export function reviewGroupForSurface(
  surface: Exclude<GitReviewReadingSurface, "committed">
): GitReviewUncommittedGroup {
  return surface === "index" ? "unstaged" : surface;
}

export const GIT_REVIEW_UNCOMMITTED_GROUP_ORDER =
  GIT_REVIEW_PRESENTATION_GROUP_ORDER.filter(
    (group): group is GitReviewUncommittedGroup => group !== "committed"
  );

export const GIT_REVIEW_READING_SURFACES =
  GIT_REVIEW_PRESENTATION_GROUP_ORDER.map(reviewSurfaceForGroup);

export const GIT_REVIEW_UNCOMMITTED_READING_SURFACES =
  GIT_REVIEW_UNCOMMITTED_GROUP_ORDER.map(reviewSurfaceForGroup);
