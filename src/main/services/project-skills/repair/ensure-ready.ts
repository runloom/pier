import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../../shared/contracts/project-skills.ts";
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
   * ensureReady lock. Best-effort only — never blocks agent spawn.
   */
  systemSkills?: {
    reconcile(args: {
      projectIdentity: StableProjectIdentity;
      rootKey: string;
    }): Promise<{ desiredProjections: DesiredSystemProjection[] }>;
  };
  systemSkillViews?: (rootKey: string) => Promise<Array<{ id: string }>>;
}

/**
 * Best-effort projection/repair before a managed agent spawn.
 *
 * Opening an agent is never a skills hygiene decision: this path may silently
 * apply safe auto-fixes, then always returns `ready`. Residual issues stay in
 * settings / snapshot only — no launch dialogs, no degrade choices.
 */
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
      // Skills I/O is unsafe against a moved/replaced root — skip repair.
      return { status: "ready", launchAttemptId, repaired: false };
    }

    // Best-effort capability channels. Failures are ignored at launch;
    // settings/doctor still surface residual state on the next snapshot.
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
      } catch {
        // Launch must not wait on capability channel failures.
      }
    }

    const observedRevision = await ctx
      .getObservedRevision(live.realPath)
      .catch(() => `observed-${ctx.now()}`);

    // Safe-only plan: no new confirmations, no user decisions at spawn.
    const plan = await buildRepairPlan(
      ctx,
      contractRef,
      observedRevision,
      undefined,
      { safeOnly: true, desiredSystemProjections }
    );

    const actionable = plan.targetOperations.filter((op) => op.kind !== "noop");
    let repaired = false;

    if (
      actionable.length > 0 &&
      plan.safeAutoFixable &&
      plan.confirmationRequirements.length === 0 &&
      !deps.disableEnsureReadyRepair
    ) {
      try {
        const operationId = randomUUID();
        const log = await prepareLog(ctx, {
          projectRef: contractRef,
          observedRevision,
          operationId,
          repairPlanDigest: plan.repairPlanDigest,
          acknowledgements: [],
          desiredSystemProjections,
        });
        const result = log.finalizedResult ?? (await drive(ctx, log));
        repaired =
          result.status === "converged" || result.status === "degraded";
      } catch {
        // Safe auto-repair failed — still open the agent.
        repaired = false;
      }
    }

    return { status: "ready", launchAttemptId, repaired };
  });
}
