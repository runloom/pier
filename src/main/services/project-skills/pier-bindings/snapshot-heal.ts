import { randomUUID } from "node:crypto";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../../shared/contracts/project-skills.ts";
import type { ProjectSkillsIssue } from "../health-mappings.ts";
import type { ProjectRootRef as MainProjectRootRef } from "../identity.ts";
import type { ProjectSkillsRepairService } from "../repair/service.ts";
import type { ProjectSkillsSnapshot } from "../snapshot-builder.ts";
import type { PierBindingsChannel } from "./index.ts";

type ProjectRef = ContractProjectRootRef | MainProjectRootRef;

/** ensureReady before snapshot; merge blocked issues into health. */
export async function healPierBindingsBeforeSnapshot(args: {
  buildSnapshot: () => Promise<ProjectSkillsSnapshot>;
  pierBindings: PierBindingsChannel | undefined;
  projectRef: ProjectRef;
  repairService: ProjectSkillsRepairService;
}): Promise<ProjectSkillsSnapshot> {
  let ensureBlockedIssues: ProjectSkillsIssue[] = [];
  if (args.pierBindings) {
    try {
      const ready = await args.repairService.ensureReady({
        projectRef: args.projectRef,
        agentId: "pier-home-bindings",
        launchAttemptId: randomUUID(),
      });
      if (ready.status === "blocked") {
        ensureBlockedIssues = ready.issueSummary;
      }
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
