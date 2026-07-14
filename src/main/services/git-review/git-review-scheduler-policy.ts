export const GIT_REVIEW_SCHEDULER_GLOBAL_RUNNING = 4;
export const GIT_REVIEW_SCHEDULER_REPOSITORY_RUNNING = 2;
export const GIT_REVIEW_SCHEDULER_GLOBAL_PENDING = 64;
export const GIT_REVIEW_SCHEDULER_REPOSITORY_PENDING = 16;
export const GIT_REVIEW_SCHEDULER_GLOBAL_LEASES = 256;
export const GIT_REVIEW_SCHEDULER_JOB_LEASES = 128;
export const GIT_REVIEW_SCHEDULER_OWNER_LEASES = 128;
export const GIT_REVIEW_SCHEDULER_AGING_MS = 250;

export function isHighPriorityGitReviewJob(
  intent: "manual-read" | "watch" | "write",
  queuedAtMs: number,
  nowMs: number
): boolean {
  return (
    intent !== "watch" || nowMs - queuedAtMs > GIT_REVIEW_SCHEDULER_AGING_MS
  );
}
