import {
  resolveStableProjectIdentity,
  type StableProjectIdentity,
  toContractProjectRootRef,
} from "./identity.ts";
import type { ProjectSkillsProjectSummary } from "./snapshot-builder.ts";
import { readManifestFile } from "./snapshot-builder.ts";

function projectIdentityKey(identity: StableProjectIdentity): string {
  return `${identity.volumeId}:${identity.directoryIdentity}`;
}

export async function buildProjectsSnapshot(args: {
  isPierHomeRoot?: (path: string) => Promise<boolean>;
  listKnownProjectRoots?: () => Promise<
    Array<{ realPath: string; source: ProjectSkillsProjectSummary["source"] }>
  >;
  now: () => number;
  projectRootPath?: string;
}): Promise<ProjectSkillsProjectSummary[]> {
  const knownRoots = (await args.listKnownProjectRoots?.()) ?? [];
  let overridePath = args.projectRootPath;
  if (
    overridePath &&
    args.isPierHomeRoot &&
    (await args.isPierHomeRoot(overridePath))
  ) {
    // Design §3.4: snapshot override must not re-inject pier-home.
    overridePath = undefined;
  }
  const roots = overridePath
    ? [
        { realPath: overridePath, source: "panel" as const },
        ...knownRoots.filter((root) => root.realPath !== overridePath),
      ]
    : knownRoots;
  const checkedAt = args.now();
  const summaries: ProjectSkillsProjectSummary[] = [];
  const seen = new Map<string, ProjectSkillsProjectSummary>();
  for (const root of roots) {
    try {
      const identity = await resolveStableProjectIdentity(root.realPath);
      const key = projectIdentityKey(identity);
      const existing = seen.get(key);
      if (existing) {
        // "environment" is the stronger fact (explicitly added to the
        // shared index); a duplicate panel entry must not mask it —
        // direct-to-detail semantics depend on it (design v8 §7.1).
        if (root.source === "environment" && existing.source === "panel") {
          existing.source = "environment";
        }
        continue;
      }
      const manifest = await readManifestFile(identity.realPath);
      const skillCount =
        manifest.status === "present" ? manifest.manifest.skills.length : 0;
      let readStatus: ProjectSkillsProjectSummary["readStatus"] = "error";
      if (manifest.status === "present") readStatus = "ok";
      else if (manifest.status === "absent") readStatus = "missing-manifest";
      else readStatus = "invalid-manifest";
      const summary: ProjectSkillsProjectSummary = {
        projectRef: toContractProjectRootRef(identity),
        displayPath: identity.realPath,
        source: root.source,
        skillCount,
        readStatus,
        checkedAt,
      };
      seen.set(key, summary);
      summaries.push(summary);
    } catch (error) {
      if (root.realPath === overridePath) {
        throw error;
      }
      // Skip unreadable roots.
    }
  }
  return summaries;
}
