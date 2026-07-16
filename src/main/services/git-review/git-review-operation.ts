export type GitReviewOperationKind = "document" | "index";

export type GitReviewCancellationReason =
  | "caller"
  | "output-limit"
  | "owner-disposed"
  | "shutdown"
  | "timeout";
