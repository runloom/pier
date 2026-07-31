export type GitReviewOperationKind = "document" | "index" | "mutation";

export type GitReviewCancellationReason =
  | "caller"
  | "output-limit"
  | "owner-disposed"
  | "shutdown"
  | "timeout";
