import type { ProjectSkillsIssue } from "./health.ts";
import type {
  PlanConfirmationRequirement,
  PlanTargetOperation,
} from "./plan.ts";
import {
  computeRepairPlanDigest,
  type ProjectSkillsRepairPlan,
} from "./repair-log.ts";

/**
 * Single owner of the repair hard-block set: issues that make a repair plan
 * non-executable. `prepareLog` MUST reject by the same set (previously a
 * drifting subset).
 */
export const REPAIR_HARD_BLOCK_CODES: readonly string[] = [
  "ledger-corrupt",
  "recovery-record-corrupt",
  "project-identity-changed",
  "invalid-skill",
  "unmanaged-conflict",
  "managed-target-modified",
];

export function hasRepairHardBlock(
  issues: readonly ProjectSkillsIssue[]
): boolean {
  return issues.some((issue) => REPAIR_HARD_BLOCK_CODES.includes(issue.code));
}

/** Repair plan flag derivation + digest sealing (file-size cap split). */
export function finalizePlan(args: {
  observedRevision: string;
  continuationOf?: string;
  targetOperations: PlanTargetOperation[];
  confirmationRequirements: PlanConfirmationRequirement[];
  blockingIssues: ProjectSkillsIssue[];
}): ProjectSkillsRepairPlan {
  const actionable = args.targetOperations.filter((op) => op.kind !== "noop");
  const hardBlock = hasRepairHardBlock(args.blockingIssues);
  const needsConfirm = args.confirmationRequirements.length > 0;
  const digestInput: {
    observedRevision: string;
    continuationOf?: string;
    targetOperations: PlanTargetOperation[];
    confirmationRequirements: PlanConfirmationRequirement[];
  } = {
    observedRevision: args.observedRevision,
    targetOperations: args.targetOperations,
    confirmationRequirements: args.confirmationRequirements,
  };
  if (args.continuationOf !== undefined) {
    digestInput.continuationOf = args.continuationOf;
  }
  const repairPlanDigest = computeRepairPlanDigest(digestInput);
  const safeAutoFixable =
    !(hardBlock || needsConfirm) &&
    actionable.every(
      (op) => op.kind === "create-symlink" || op.kind === "delete-symlink"
    ) &&
    !args.blockingIssues.some(
      (i) =>
        i.degradePolicy === "denied" ||
        i.degradePolicy === "requires-content-risk-confirmation"
    );

  const plan: ProjectSkillsRepairPlan = {
    observedRevision: args.observedRevision,
    targetOperations: args.targetOperations,
    confirmationRequirements: args.confirmationRequirements,
    blockingIssues: args.blockingIssues,
    repairPlanDigest,
    executable: !hardBlock && (!needsConfirm || actionable.length > 0),
    safeAutoFixable,
  };
  if (args.continuationOf !== undefined) {
    plan.continuationOf = args.continuationOf;
  }
  return plan;
}
