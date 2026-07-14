export const GIT_REVIEW_OPERATION_KINDS = [
  "index",
  "document",
  "hydrate",
  "patch",
  "action",
  "commit-search",
] as const;

export type GitReviewOperationKind =
  (typeof GIT_REVIEW_OPERATION_KINDS)[number];

export type GitReviewOperationState =
  | "cancelled"
  | "queued"
  | "running"
  | "settled";

export type GitReviewCancellationReason =
  | "caller"
  | "file-limit"
  | "output-limit"
  | "owner-disposed"
  | "shutdown"
  | "superseded"
  | "timeout";
