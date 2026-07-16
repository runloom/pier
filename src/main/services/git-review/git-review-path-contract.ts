export type GitReviewPathErrorReason =
  | "aborted"
  | "changed"
  | "missing"
  | "notRegular"
  | "outsideRoot"
  | "readFailed"
  | "symlink"
  | "tooLarge";

export class GitReviewPathError extends Error {
  readonly reason: GitReviewPathErrorReason;

  constructor(
    reason: GitReviewPathErrorReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GitReviewPathError";
    this.reason = reason;
  }
}
