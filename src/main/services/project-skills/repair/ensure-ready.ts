import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  ProjectRootRef as ContractProjectRootRef,
  DegradePolicy,
} from "../../../../shared/contracts/project-skills.ts";
import { buildProjectSkillsIssue, type ProjectSkillsIssue } from "../health.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
} from "../identity.ts";
import type { ProjectSkillsLock } from "../lock.ts";
import {
  type EnsureReadyResult,
  type RepairContext,
  readManifestState,
  toIdentity,
} from "./log.ts";
import {
  buildRepairPlan,
  type DesiredSystemProjection,
  resolveLive,
} from "./plan-builder.ts";
import { prepareLog } from "./prepare.ts";
import { drive } from "./reconcile.ts";

function worstDegradePolicy(
  issues: readonly ProjectSkillsIssue[]
): DegradePolicy {
  for (const issue of issues) {
    if (issue.degradePolicy === "denied") return "denied";
  }
  return "allowed";
}

export interface EnsureReadyDeps {
  ctx: RepairContext;
  /** When true, ensureReady will not attempt auto-repair writes (tests). */
  disableEnsureReadyRepair?: boolean;
  lock: ProjectSkillsLock;
  /**
   * Pier Home library → project bind channel (design 2026-07-23 §0.7).
   * Reconciled alongside system skills; projections share the same plan input.
   */
  pierBindings?: {
    reconcile(args: {
      manifestSkillIds?: ReadonlySet<string>;
      projectIdentity: StableProjectIdentity;
      rootKey: string;
      systemSkillIds?: ReadonlySet<string>;
    }): Promise<{ desiredProjections: DesiredSystemProjection[] }>;
  };
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
  systemSkillViews?: (rootKey: string) => Promise<Array<{ id: string }>>;
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
    const capabilityChannels = [
      deps.systemSkills
        ? { name: "systemSkills" as const, channel: deps.systemSkills }
        : null,
      deps.pierBindings
        ? { name: "pierBindings" as const, channel: deps.pierBindings }
        : null,
    ].filter(
      (
        entry
      ): entry is {
        name: "systemSkills" | "pierBindings";
        channel: NonNullable<typeof deps.systemSkills>;
      } => entry !== null
    );
    let manifestSkillIds: ReadonlySet<string> = new Set();
    let systemSkillIds: ReadonlySet<string> = new Set();
    if (deps.pierBindings) {
      try {
        const manifestState = await readManifestState(live.realPath);
        if (manifestState.status === "present") {
          manifestSkillIds = new Set(
            manifestState.manifest.skills.map((s) => s.id)
          );
        }
      } catch {
        // Retirement falls back to digests-only without manifest ids.
      }
      if (deps.systemSkillViews) {
        try {
          const views = await deps.systemSkillViews(rootKey);
          systemSkillIds = new Set(views.map((v) => v.id));
        } catch {
          // Ignore.
        }
      }
    }
    for (const { name, channel } of capabilityChannels) {
      try {
        const result = await channel.reconcile({
          projectIdentity: live,
          rootKey,
          ...(name === "pierBindings"
            ? { manifestSkillIds, systemSkillIds }
            : {}),
        });
        desiredSystemProjections = [
          ...desiredSystemProjections,
          ...result.desiredProjections,
        ];
      } catch (error) {
        const issue = buildProjectSkillsIssue({
          code: "projection-missing",
          scope: "project",
          checkedAt: ctx.now(),
          evidence: {
            [name]: true,
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

    // Hard blocks: only launch-scoped issues. Denied integrity without a
    // launch scope (e.g. library-drift → settings-only) must not refuse spawn.
    const hard = plan.blockingIssues.filter(
      (i) =>
        i.blockingScopes.includes("launch") &&
        (i.code === "ledger-corrupt" ||
          i.code === "recovery-record-corrupt" ||
          i.code === "unmanaged-conflict" ||
          i.code === "managed-target-modified" ||
          i.code === "invalid-skill" ||
          i.code === "project-identity-changed" ||
          i.degradePolicy === "denied")
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
      // Needs confirmation or not safe — do not write during launch.
      // Only refuse spawn for launch-scoped issues. Settings-only integrity
      // (e.g. library-drift) must not hard-block opening an agent; skip the
      // non-safe repair and continue.
      if (blockingForLaunch.length > 0) {
        return {
          status: "blocked",
          launchAttemptId,
          issueSummary: blockingForLaunch,
          degradePolicySummary: worstDegradePolicy(blockingForLaunch),
          expiresAt: ctx.now() + 120_000,
        };
      }
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
