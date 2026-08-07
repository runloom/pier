import { randomUUID } from "node:crypto";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../../shared/contracts/project-skills.ts";
import type { ProjectSkillsIssue } from "../health-mappings.ts";
import type { ProjectRootRef as MainProjectRootRef } from "../identity.ts";
import type { ProjectSkillsRepairService } from "../repair/service.ts";
import type { ProjectSkillsSnapshot } from "../snapshot-builder.ts";

type ProjectRef = ContractProjectRootRef | MainProjectRootRef;

/** Skip re-heal for the same project root shortly after a successful pass. */
const HEAL_COOLDOWN_MS = 15_000;

const healInflightByRootKey = new Map<string, Promise<void>>();
const healLastDoneAtByRootKey = new Map<string, number>();

function rootKeyForHeal(projectRef: ProjectRef): string {
  if ("identity" in projectRef) {
    const id = projectRef.identity;
    return `${id.volumeId}\0${id.directoryIdentity}`;
  }
  return `${projectRef.volumeIdentity}\0${projectRef.directoryIdentity}`;
}

/**
 * Best-effort ensureReady before skills.snapshot so Pier capability channels
 * (system skills + Pier Home binds) converge without requiring an agent
 * spawn. Never blocks the snapshot; residual issues merge into health.
 *
 * System skills are Pier product surface: opening the skills settings page
 * must inject them even when no pier-bound skills exist for the project.
 *
 * Coalesces concurrent heals and cools down per root so repeated snapshot
 * polls after first converge stay cheap.
 */
export async function healCapabilityChannelsBeforeSnapshot(args: {
  buildSnapshot: () => Promise<ProjectSkillsSnapshot>;
  /** When true, run ensureReady (system skills and/or pier bindings wired). */
  heal: boolean;
  projectRef: ProjectRef;
  repairService: ProjectSkillsRepairService;
}): Promise<ProjectSkillsSnapshot> {
  let ensureBlockedIssues: ProjectSkillsIssue[] = [];
  if (args.heal) {
    const rootKey = rootKeyForHeal(args.projectRef);
    try {
      await runHealedEnsureReady({
        rootKey,
        projectRef: args.projectRef,
        repairService: args.repairService,
        onBlocked: (issues) => {
          ensureBlockedIssues = issues;
        },
      });
    } catch {
      // Keep snapshot on heal failure.
    }
  }
  const snap = await args.buildSnapshot();
  if (ensureBlockedIssues.length === 0) return snap;
  const seen = new Set(snap.health.issues.map((issue) => issue.id));
  const extra = ensureBlockedIssues.filter((issue) => !seen.has(issue.id));
  if (extra.length === 0) return snap;
  return {
    ...snap,
    health: {
      ...snap.health,
      issues: [...snap.health.issues, ...extra],
    },
  };
}

async function runHealedEnsureReady(args: {
  onBlocked: (issues: ProjectSkillsIssue[]) => void;
  projectRef: ProjectRef;
  repairService: ProjectSkillsRepairService;
  rootKey: string;
}): Promise<void> {
  const existing = healInflightByRootKey.get(args.rootKey);
  if (existing) {
    await existing;
    return;
  }
  const lastDone = healLastDoneAtByRootKey.get(args.rootKey) ?? 0;
  if (Date.now() - lastDone < HEAL_COOLDOWN_MS) {
    return;
  }

  const work = (async () => {
    const ready = await args.repairService.ensureReady({
      projectRef: args.projectRef,
      agentId: "skills-snapshot-heal",
      launchAttemptId: randomUUID(),
    });
    if (ready.status === "blocked") {
      args.onBlocked(ready.issueSummary);
    }
    healLastDoneAtByRootKey.set(args.rootKey, Date.now());
  })().finally(() => {
    healInflightByRootKey.delete(args.rootKey);
  });

  healInflightByRootKey.set(args.rootKey, work);
  await work;
}

export function __resetSnapshotHealCooldownForTests(): void {
  healInflightByRootKey.clear();
  healLastDoneAtByRootKey.clear();
}
