import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  ProjectRootRef as ContractProjectRootRef,
  DegradePolicy,
} from "../../../shared/contracts/project-skills.ts";
import { buildProjectSkillsIssue, type ProjectSkillsIssue } from "./health.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
} from "./identity.ts";
import type { ProjectSkillsLock } from "./lock.ts";
import {
  type EnsureReadyResult,
  type RepairContext,
  toIdentity,
} from "./repair-log.ts";
import {
  buildRepairPlan,
  type DesiredSystemProjection,
  resolveLive,
} from "./repair-plan-builder.ts";
import { prepareLog } from "./repair-prepare.ts";
import { drive } from "./repair-reconcile.ts";

function worstDegradePolicy(
  issues: readonly ProjectSkillsIssue[]
): DegradePolicy {
  let worst: DegradePolicy = "allowed";
  for (const issue of issues) {
    if (issue.degradePolicy === "denied") return "denied";
    if (issue.degradePolicy === "requires-content-risk-confirmation") {
      worst = "requires-content-risk-confirmation";
    }
  }
  return worst;
}

export interface EnsureReadyDeps {
  ctx: RepairContext;
  /** When true, ensureReady will not attempt auto-repair writes (tests). */
  disableEnsureReadyRepair?: boolean;
  lock: ProjectSkillsLock;
  /**
   * Pier system skills channel (design v8 §8): reconciled inside the
   * ensureReady lock before the launch decision — injection completes before
   * spawn or the launch is blocked.
   */
  systemSkills?: {
    reconcile(args: {
      projectIdentity: StableProjectIdentity;
      rootKey: string;
    }): Promise<{ desiredProjections: DesiredSystemProjection[] }>;
  };
}

export async function ensureReady(
  deps: EnsureReadyDeps,
  args: {
    projectRef: ContractProjectRootRef | MainProjectRootRef;
    agentId: string;
    launchAttemptId: string;
  }
): Promise<EnsureReadyResult> {
  const { ctx } = deps;
  const { projectRef, launchAttemptId } = args;
  const claimed = toIdentity(projectRef);
  const liveIdentity = await resolveStableProjectIdentity(claimed.realPath);
  const rootKeyForLock = ctx.paths.rootKeyFor(liveIdentity);
  const lockPaths = [
    liveIdentity.realPath,
    ctx.paths.projectDir(rootKeyForLock),
    join(liveIdentity.realPath, ".pier"),
    join(liveIdentity.realPath, ".agents"),
  ];
  return deps.lock.runExclusive(liveIdentity, lockPaths, async () => {
    const {
      live,
      rootKey,
      projectRef: contractRef,
    } = await resolveLive(ctx, projectRef);
    if (
      live.volumeId !== claimed.volumeId ||
      live.directoryIdentity !== claimed.directoryIdentity
    ) {
      const issue = buildProjectSkillsIssue({
        code: "project-identity-changed",
        scope: "project",
        checkedAt: ctx.now(),
      });
      return {
        status: "blocked",
        launchAttemptId,
        issueSummary: [issue],
        degradePolicySummary: "denied",
        expiresAt: ctx.now() + 120_000,
      };
    }

    // In-flight apply recovery converges via the recovery coordinator
    // (callers with known ops drive it); ensureReady only auto-fixes.

    // System skills channel (design v8 §8): publish/refresh capability
    // skills inside the same lock — injection completes before spawn,
    // failure blocks the launch (default no-launch on failure).
    let desiredSystemProjections: DesiredSystemProjection[] = [];
    if (deps.systemSkills) {
      try {
        const systemResult = await deps.systemSkills.reconcile({
          projectIdentity: live,
          rootKey,
        });
        desiredSystemProjections = systemResult.desiredProjections;
      } catch (error) {
        const issue = buildProjectSkillsIssue({
          code: "projection-missing",
          scope: "project",
          checkedAt: ctx.now(),
          evidence: {
            systemSkills: true,
            message: error instanceof Error ? error.message : String(error),
          },
        });
        return {
          status: "blocked",
          launchAttemptId,
          issueSummary: [issue],
          degradePolicySummary: "allowed",
          expiresAt: ctx.now() + 120_000,
        };
      }
    }

    const observedRevision = await ctx
      .getObservedRevision(live.realPath)
      .catch(() => `observed-${ctx.now()}`);

    // Safe-only plan: no new confirmations.
    const plan = await buildRepairPlan(
      ctx,
      contractRef,
      observedRevision,
      undefined,
      { safeOnly: true, desiredSystemProjections }
    );

    const blockingForLaunch = plan.blockingIssues.filter((issue) =>
      issue.blockingScopes.includes("launch")
    );

    // Hard blocks: corrupt / unmanaged / invalid.
    const hard = plan.blockingIssues.filter(
      (i) =>
        i.code === "ledger-corrupt" ||
        i.code === "recovery-record-corrupt" ||
        i.code === "unmanaged-conflict" ||
        i.code === "managed-target-modified" ||
        i.code === "invalid-skill" ||
        i.code === "project-identity-changed" ||
        i.degradePolicy === "denied"
    );

    if (hard.length > 0) {
      return {
        status: "blocked",
        launchAttemptId,
        issueSummary: hard,
        degradePolicySummary: worstDegradePolicy(hard),
        expiresAt: ctx.now() + 120_000,
      };
    }

    const actionable = plan.targetOperations.filter((op) => op.kind !== "noop");
    let repaired = false;

    if (
      actionable.length > 0 &&
      plan.safeAutoFixable &&
      plan.confirmationRequirements.length === 0 &&
      !deps.disableEnsureReadyRepair
    ) {
      const operationId = randomUUID();
      const log = await prepareLog(ctx, {
        projectRef: contractRef,
        observedRevision,
        operationId,
        repairPlanDigest: plan.repairPlanDigest,
        acknowledgements: [],
      });
      const result = log.finalizedResult ?? (await drive(ctx, log));
      repaired = result.status === "converged" || result.status === "degraded";
      if (result.status === "degraded" || result.status === "indeterminate") {
        const issues =
          result.status === "degraded"
            ? plan.blockingIssues.filter((i) =>
                result.pendingIssueIds.some((id) => id.includes(i.code))
              )
            : plan.blockingIssues;
        const summary =
          issues.length > 0
            ? issues
            : [
                buildProjectSkillsIssue({
                  code: "recovery-pending",
                  scope: "project",
                  checkedAt: ctx.now(),
                }),
              ];
        return {
          status: "blocked",
          launchAttemptId,
          issueSummary: summary,
          degradePolicySummary: worstDegradePolicy(summary),
          expiresAt: ctx.now() + 120_000,
        };
      }
    } else if (actionable.length > 0 && !plan.safeAutoFixable) {
      // Needs confirmation or not safe — block, do not write.
      const fallbackIssues =
        plan.blockingIssues.length > 0
          ? plan.blockingIssues
          : [
              buildProjectSkillsIssue({
                code: "projection-missing",
                scope: "project",
                checkedAt: ctx.now(),
              }),
            ];
      const summary =
        blockingForLaunch.length > 0 ? blockingForLaunch : fallbackIssues;
      return {
        status: "blocked",
        launchAttemptId,
        issueSummary: summary,
        degradePolicySummary: worstDegradePolicy(summary),
        expiresAt: ctx.now() + 120_000,
      };
    } else if (blockingForLaunch.length > 0) {
      return {
        status: "blocked",
        launchAttemptId,
        issueSummary: blockingForLaunch,
        degradePolicySummary: worstDegradePolicy(blockingForLaunch),
        expiresAt: ctx.now() + 120_000,
      };
    }

    return { status: "ready", launchAttemptId, repaired };
  });
}
