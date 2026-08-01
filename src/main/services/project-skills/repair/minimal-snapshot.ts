import type {
  ProjectRootRef as ContractProjectRootRef,
  ProjectSkillsManifest,
} from "../../../../shared/contracts/project-skills.ts";

/**
 * Compact snapshot carried by repair terminal results (no skills rows —
 * the operations timeline is deferred; see snapshot-builder for the full
 * view). Split from reconcile.ts (file-size cap).
 */
export function minimalSnapshot(args: {
  pendingIssueIds: string[];
  projectRef: ContractProjectRootRef;
  manifest: ProjectSkillsManifest | null;
  manifestRevision: string | null;
  observedRevision: string;
}): unknown {
  return {
    pendingIssueIds: args.pendingIssueIds,
    projectRef: args.projectRef,
    manifestRevision: args.manifestRevision,
    observedRevision: args.observedRevision,
    manifest: args.manifest,
    skills: args.manifest?.skills ?? [],
  };
}
