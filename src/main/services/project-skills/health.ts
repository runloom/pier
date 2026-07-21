import type { ProjectRootRef as ContractProjectRootRef } from "../../../shared/contracts/project-skills.ts";
import {
  createSkillDiscoveryAdapterRegistry,
  listDuplicateDiscoveryAgentKinds,
  PIER_PROJECTION_TARGET_AGENTS_ROOT,
  PIER_PROJECTION_TARGET_CLAUDE_ROOT,
  type SkillDiscoveryAdapterRegistry,
} from "./adapters.ts";
import { enumerateProjectDiscoveryRoots } from "./enumeration.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
} from "./identity.ts";
import { inspectLibraryContent } from "./library-state.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import { readManifestState } from "./repair-log.ts";
import {
  createProjectSkillsStore,
  ProjectSkillsLedgerCorrupt,
  type ProjectSkillsStore,
} from "./store.ts";

export {
  buildProjectSkillsIssue,
  getHealthIssueMapping,
  HEALTH_ISSUE_MAPPINGS,
  type HealthBlockingScope,
  type HealthIssueMapping,
  type HealthIssueSeverity,
  type ProjectSkillsIssue,
  type SnapshotHealth,
} from "./health-mappings.ts";

import {
  buildProjectSkillsIssue,
  type ProjectSkillsIssue,
  type SnapshotHealth,
} from "./health-mappings.ts";

export interface ProjectSkillsHealthService {
  doctor(
    projectRef: ContractProjectRootRef | MainProjectRootRef
  ): Promise<SnapshotHealth>;
}

export interface CreateProjectSkillsHealthServiceOptions {
  adapterRegistry?: SkillDiscoveryAdapterRegistry;
  now?: () => number;
  store?: ProjectSkillsStore;
  userData: string;
}

function flattenProjectRef(
  projectRef: ContractProjectRootRef | MainProjectRootRef
): ContractProjectRootRef {
  if ("identity" in projectRef) {
    return {
      realPath: projectRef.realPath,
      volumeIdentity: projectRef.identity.volumeId,
      directoryIdentity: projectRef.identity.directoryIdentity,
      token: projectRef.token,
    };
  }
  return projectRef;
}

function toIdentity(
  projectRef: ContractProjectRootRef | MainProjectRootRef
): StableProjectIdentity {
  if ("identity" in projectRef) {
    return projectRef.identity;
  }
  return {
    realPath: projectRef.realPath,
    volumeId: projectRef.volumeIdentity,
    directoryIdentity: projectRef.directoryIdentity,
  };
}

export function createProjectSkillsHealthService(
  options: CreateProjectSkillsHealthServiceOptions
): ProjectSkillsHealthService {
  const store =
    options.store ?? createProjectSkillsStore({ userData: options.userData });
  const paths = createProjectSkillsPaths(options.userData);
  const adapterRegistry =
    options.adapterRegistry ?? createSkillDiscoveryAdapterRegistry();
  const now = options.now ?? Date.now;
  return {
    async doctor(projectRefInput): Promise<SnapshotHealth> {
      const checkedAt = now();
      const projectRef = flattenProjectRef(projectRefInput);
      const claimed = toIdentity(projectRefInput);
      const live = await resolveStableProjectIdentity(projectRef.realPath);
      const issues: ProjectSkillsIssue[] = [];

      if (
        live.volumeId !== claimed.volumeId ||
        live.directoryIdentity !== claimed.directoryIdentity
      ) {
        issues.push(
          buildProjectSkillsIssue({
            code: "project-identity-changed",
            scope: "project",
            checkedAt,
            evidence: {
              claimedVolumeId: claimed.volumeId,
              liveVolumeId: live.volumeId,
            },
          })
        );
        return { projectRef, issues, checkedAt };
      }

      const rootKey = paths.rootKeyFor(live);
      let ownership: Awaited<ReturnType<typeof store.readOwnership>> = null;
      try {
        ownership = await store.readOwnership(rootKey);
      } catch (error) {
        if (error instanceof ProjectSkillsLedgerCorrupt) {
          issues.push(
            buildProjectSkillsIssue({
              code: error.code,
              scope: "project",
              checkedAt,
              evidence: { message: error.message },
            })
          );
        } else {
          throw error;
        }
      }

      const manifestState = await readManifestState(live.realPath);
      if (manifestState.status === "invalid") {
        issues.push(
          buildProjectSkillsIssue({
            code: "invalid-skill",
            scope: "project",
            checkedAt,
            evidence: { reason: manifestState.reason },
          })
        );
        return { projectRef, issues, checkedAt };
      }

      const manifest =
        manifestState.status === "present" ? manifestState.manifest : null;
      if (manifest) {
        // Drift/missing: every non-system library entry (snapshot consumes
        // these issues — do not re-push there).
        for (const entry of manifest.skills) {
          const inspection = await inspectLibraryContent(
            live.realPath,
            entry.id,
            entry.contentDigest
          );
          if (inspection.state === "missing") {
            issues.push(
              buildProjectSkillsIssue({
                code: "missing-source",
                scope: "skill",
                skillId: entry.id,
                checkedAt,
                evidence: { expectedContentDigest: entry.contentDigest },
              })
            );
          } else if (inspection.state !== "ok") {
            issues.push(
              buildProjectSkillsIssue({
                code: "library-drift",
                scope: "skill",
                skillId: entry.id,
                checkedAt,
                evidence: {
                  expectedContentDigest: entry.contentDigest,
                  actualContentDigest: inspection.actualDigest,
                },
              })
            );
          }
        }

        // Real duplicates: both delivery roots + at least one skill projected
        // into both discovery roots (v8.2 — match plan.ts).
        if (manifest.delivery.agents && manifest.delivery.claude) {
          const presence = await enumerateProjectDiscoveryRoots({
            projectRoot: live.realPath,
            ownership,
          });
          const anyDualProjection = [
            ...presence.ownedProjectedRoots.values(),
          ].some(
            (roots) =>
              roots.includes(PIER_PROJECTION_TARGET_AGENTS_ROOT) &&
              roots.includes(PIER_PROJECTION_TARGET_CLAUDE_ROOT)
          );
          if (anyDualProjection) {
            const dupKinds = listDuplicateDiscoveryAgentKinds({
              registry: adapterRegistry,
              dualDelivery: true,
            });
            for (const adapterKind of dupKinds) {
              issues.push(
                buildProjectSkillsIssue({
                  code: "duplicate-discovery",
                  scope: "adapter",
                  adapterKind,
                  checkedAt,
                  evidence: {
                    deliveryAgents: true,
                    deliveryClaude: true,
                    discoveryRoots:
                      adapterRegistry.get(adapterKind)?.discoveryRoots ?? [],
                  },
                })
              );
            }
          }
        }
      }

      return { projectRef, issues, checkedAt };
    },
  };
}

/** Convenience facade matching the brief `doctor(projectRef)` surface. */
export async function doctor(
  projectRef: ContractProjectRootRef | MainProjectRootRef,
  options: CreateProjectSkillsHealthServiceOptions
): Promise<SnapshotHealth> {
  return createProjectSkillsHealthService(options).doctor(projectRef);
}
