import { join } from "node:path";
import { listPierProjectionRoots } from "../../../shared/contracts/project-skills.ts";
import {
  createSkillDiscoveryAdapterRegistry,
  listDuplicateDiscoveryAgentKinds,
  PIER_PROJECTION_TARGET_AGENTS_ROOT,
  PIER_PROJECTION_TARGET_CLAUDE_ROOT,
} from "./adapters.ts";
import { buildProjectSkillsIssue, type ProjectSkillsIssue } from "./health.ts";
import { resolveStableProjectIdentity } from "./identity.ts";
import {
  classifyTargetShape,
  inspectLibraryContentState,
} from "./library-state.ts";
import { createObservedRevisionProvider } from "./observed-revision.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import {
  compareOps,
  contentDeleteRequirement,
  defaultInspectGitState,
  emptyBlockedPlan,
  expectedLinkTarget,
  toIdentity,
} from "./plan-helpers.ts";
import { readManifestState } from "./repair-log.ts";
import {
  createProjectSkillsStore,
  ProjectSkillsLedgerCorrupt,
} from "./store.ts";

/** Git five-state for managed projection targets (design §3.6 / §8). */
export {
  type CreateProjectSkillsPlanServiceOptions,
  computePlanDigest,
  type GitFiveState,
  type NormalizedProjectSkillsDraft,
  normalizeProjectSkillsDraft,
  type PlanConfirmationRequirement,
  type PlanGitState,
  type PlanTargetOperation,
  type ProjectSkillsPlan,
  type ProjectSkillsPlanService,
} from "./plan-types.ts";

import {
  type CreateProjectSkillsPlanServiceOptions,
  computePlanDigest,
  type GitFiveState,
  normalizeProjectSkillsDraft,
  type PlanConfirmationRequirement,
  type PlanGitState,
  type PlanTargetOperation,
  type ProjectSkillsPlan,
  type ProjectSkillsPlanService,
} from "./plan-types.ts";

// Projection targets are owned by the adapter registry module; plan only
// decides WHEN to project from the delivery flags (none ⇒ no projection).
const AGENTS_SKILLS = PIER_PROJECTION_TARGET_AGENTS_ROOT;
const CLAUDE_SKILLS = PIER_PROJECTION_TARGET_CLAUDE_ROOT;

export class ProjectSkillsPlanStaleError extends Error {
  constructor() {
    super("observedRevision mismatch");
    this.name = "ProjectSkillsPlanStaleError";
  }
}

export class ProjectSkillsCandidateUnavailableError extends Error {
  readonly code: "token-expired" | "token-unavailable";

  constructor(
    code: ProjectSkillsCandidateUnavailableError["code"],
    token: string
  ) {
    super(
      code === "token-expired"
        ? `import token expired: ${token}`
        : `import token unavailable: ${token}`
    );
    this.name = "ProjectSkillsCandidateUnavailableError";
    this.code = code;
  }
}

export function createProjectSkillsPlanService(
  options: CreateProjectSkillsPlanServiceOptions
): ProjectSkillsPlanService {
  const store =
    options.store ?? createProjectSkillsStore({ userData: options.userData });
  const paths = createProjectSkillsPaths(options.userData);
  const adapterRegistry =
    options.adapterRegistry ?? createSkillDiscoveryAdapterRegistry();
  const now = options.now ?? Date.now;
  const inspectGitState = options.inspectGitState ?? defaultInspectGitState;
  const getObservedRevision =
    options.getObservedRevision ??
    createObservedRevisionProvider({ store, userData: options.userData });

  return {
    async plan(
      projectRefInput,
      observedRevision,
      draft
    ): Promise<ProjectSkillsPlan> {
      const checkedAt = now();
      const claimed = toIdentity(projectRefInput);
      const live = await resolveStableProjectIdentity(
        "realPath" in projectRefInput
          ? projectRefInput.realPath
          : claimed.realPath
      );
      const normalizedDraft = normalizeProjectSkillsDraft(draft);
      const blockingIssues: ProjectSkillsIssue[] = [];

      if (
        live.volumeId !== claimed.volumeId ||
        live.directoryIdentity !== claimed.directoryIdentity
      ) {
        blockingIssues.push(
          buildProjectSkillsIssue({
            code: "project-identity-changed",
            scope: "project",
            checkedAt,
          })
        );
        return emptyBlockedPlan({
          observedRevision,
          normalizedDraft,
          blockingIssues,
        });
      }

      const liveObservedRevision = await getObservedRevision(live.realPath);
      if (liveObservedRevision !== observedRevision) {
        throw new ProjectSkillsPlanStaleError();
      }

      const rootKey = paths.rootKeyFor(live);
      let ownership: Awaited<ReturnType<typeof store.readOwnership>> = null;
      try {
        ownership = await store.readOwnership(rootKey);
      } catch (error) {
        if (error instanceof ProjectSkillsLedgerCorrupt) {
          blockingIssues.push(
            buildProjectSkillsIssue({
              code: error.code,
              scope: "project",
              checkedAt,
              evidence: { message: error.message },
            })
          );
          return emptyBlockedPlan({
            observedRevision,
            normalizedDraft,
            blockingIssues,
          });
        }
        throw error;
      }
      const ownedPaths = new Set(
        (ownership?.targets ?? []).map((t) => t.relativePath)
      );
      // Manifest three-state semantics (design §5.1): an invalid manifest is
      // a blocked plan, never treated as empty and never a raw exception.
      const manifestState = await readManifestState(live.realPath);
      if (manifestState.status === "invalid") {
        blockingIssues.push(
          buildProjectSkillsIssue({
            code: "invalid-skill",
            scope: "project",
            checkedAt,
            evidence: { reason: manifestState.reason },
          })
        );
        return emptyBlockedPlan({
          observedRevision,
          normalizedDraft,
          blockingIssues,
        });
      }
      const manifest =
        manifestState.status === "present" ? manifestState.manifest : null;
      const manifestSkills = new Map(
        (manifest?.skills ?? []).map((s) => [s.id, s] as const)
      );

      // Import / content-update candidates carried by the draft: their digest
      // is the post-apply manifest digest for that skill (design v8).
      const candidateBySkillId = new Map<
        string,
        { contentDigest: string; sourceKind: string }
      >();
      for (const token of normalizedDraft.importTokens) {
        const candidate = await store.readCandidate(rootKey, token);
        if (candidate?.state !== "AVAILABLE") {
          throw new ProjectSkillsCandidateUnavailableError(
            "token-unavailable",
            token
          );
        }
        if (candidate.expiresAt <= checkedAt) {
          throw new ProjectSkillsCandidateUnavailableError(
            "token-expired",
            token
          );
        }
        candidateBySkillId.set(candidate.skillId, {
          contentDigest: candidate.contentDigest,
          sourceKind: candidate.sourceKind,
        });
      }

      // Effective desired enablement after draft overlay.
      const desiredEnabled = new Map<string, boolean>();
      for (const entry of manifest?.skills ?? []) {
        desiredEnabled.set(entry.id, entry.enabled);
      }
      for (const skillId of candidateBySkillId.keys()) {
        if (!desiredEnabled.has(skillId)) {
          // Fresh imports default to disabled (design v8 §7.5).
          desiredEnabled.set(skillId, false);
        }
      }
      for (const [skillId, enabled] of Object.entries(
        normalizedDraft.enabledBySkillId
      )) {
        desiredEnabled.set(skillId, enabled);
      }
      for (const skillId of normalizedDraft.deleteSkillIds) {
        desiredEnabled.delete(skillId);
      }

      const delivery = {
        agents: normalizedDraft.deliveryAgents,
        claude: normalizedDraft.deliveryClaude,
      };
      const previousDelivery = {
        agents: Boolean(manifest?.delivery.agents),
        claude: Boolean(manifest?.delivery.claude),
      };
      const targetOperations: PlanTargetOperation[] = [];
      const confirmationRequirements: PlanConfirmationRequirement[] = [];
      const gitStateByTarget = new Map<string, GitFiveState>();
      // Whether any skill will actually live in BOTH projection roots —
      // only then do multi-root scanners really see duplicates.
      let anyDualProjection = false;

      const skillIds = [
        ...new Set([
          ...desiredEnabled.keys(),
          ...Object.keys(normalizedDraft.enabledBySkillId),
          ...candidateBySkillId.keys(),
          ...(manifest?.skills.map((s) => s.id) ?? []),
        ]),
      ].sort();

      for (const skillId of skillIds) {
        if (normalizedDraft.deleteSkillIds.includes(skillId)) {
          // Deletion always confirms at apply time, bound to the actual tree
          // digest the user saw (design §7.3 / §4.4).
          const deleteReq = await contentDeleteRequirement(
            live.realPath,
            skillId,
            manifestSkills.get(skillId)?.contentDigest ?? ""
          );
          if (deleteReq) {
            confirmationRequirements.push(deleteReq);
          }
        }
        const entry = manifestSkills.get(skillId);
        const wantEnabled = desiredEnabled.get(skillId) === true;
        const contentDigest =
          candidateBySkillId.get(skillId)?.contentDigest ??
          entry?.contentDigest ??
          "";
        // Keeping/enabling a skill whose library content no longer matches the
        // manifest digest is blocked as an integrity conflict. Content updates
        // and "use current files" carry a candidate and are exempt because
        // apply replaces or adopts the content. Disable/delete stay applicable.
        if (entry && wantEnabled && !candidateBySkillId.has(skillId)) {
          const contentState = await inspectLibraryContentState(
            live.realPath,
            skillId,
            entry.contentDigest
          );
          if (contentState === "missing") {
            blockingIssues.push(
              buildProjectSkillsIssue({
                code: "missing-source",
                scope: "skill",
                skillId,
                checkedAt,
                evidence: { expectedContentDigest: entry.contentDigest },
              })
            );
            continue;
          }
          if (contentState === "drifted" || contentState === "unreadable") {
            blockingIssues.push(
              buildProjectSkillsIssue({
                code: "library-drift",
                scope: "skill",
                skillId,
                checkedAt,
                evidence: { expectedContentDigest: entry.contentDigest },
              })
            );
            continue;
          }
        }

        const projectionRoots = listPierProjectionRoots(delivery);
        const previousRoots = listPierProjectionRoots(previousDelivery);
        const teardownRoots = previousRoots.filter(
          (root) => !projectionRoots.includes(root)
        );

        const rootsToConsider = [
          ...new Set([...projectionRoots, ...teardownRoots]),
        ];

        for (const root of rootsToConsider) {
          const relativeTarget = `${root}/${skillId}`;
          const shouldExist =
            wantEnabled &&
            contentDigest.length > 0 &&
            projectionRoots.includes(root);

          const gitState = await inspectGitState(relativeTarget, live.realPath);
          gitStateByTarget.set(relativeTarget, gitState);
          const shape = await classifyTargetShape(
            join(live.realPath, ...relativeTarget.split("/")),
            expectedLinkTarget(skillId)
          );
          const owned = ownedPaths.has(relativeTarget);
          // Managed classification joins the ownership ledger (design §3.5):
          // a pier-shaped symlink WITHOUT a ledger entry (another profile's
          // projection, lost ledger) is unmanaged — never overwritten or
          // deleted, exactly like a foreign directory.
          const foreignish =
            shape === "foreign" || (shape === "pier-symlink" && !owned);

          if (shouldExist) {
            if (foreignish) {
              // Preflight what apply would refuse anyway (design §5.1:
              // unmanaged-conflict blocks plans that need this target).
              blockingIssues.push(
                buildProjectSkillsIssue({
                  code: "unmanaged-conflict",
                  scope: "skill",
                  skillId,
                  relativeTarget,
                  checkedAt,
                  evidence: { relativeTarget },
                })
              );
              continue;
            }
            targetOperations.push({
              kind: "create-symlink",
              relativeTarget,
              skillId,
              expectedRelativeLinkTarget: expectedLinkTarget(skillId),
            });
            if (
              projectionRoots.includes(AGENTS_SKILLS) &&
              projectionRoots.includes(CLAUDE_SKILLS)
            ) {
              anyDualProjection = true;
            }
            continue;
          }

          // Teardown authorization: the ownership ledger, or — for targets
          // absent on disk — a manifest entry (idempotent cleanup of ledger
          // and Git remnants; apply records ENOENT deletes as noops).
          // Unowned on-disk objects are never scheduled for deletion.
          const teardownAuthorized =
            owned || (shape === "absent" && entry !== undefined);
          if (!teardownAuthorized || foreignish) {
            continue;
          }
          const disableIntent =
            normalizedDraft.enabledBySkillId[skillId] === false ||
            normalizedDraft.deleteSkillIds.includes(skillId) ||
            (previousDelivery.claude && !delivery.claude) ||
            (previousDelivery.agents && !delivery.agents);
          const presentIsh = shape === "pier-symlink" || gitState !== "absent";

          if (disableIntent || presentIsh) {
            targetOperations.push({
              kind: "delete-symlink",
              relativeTarget,
              skillId,
            });
            // Only tracked targets require explicit destructive confirmation
            // (design §5.1; untracked/ignored removals do not surface in the
            // repo diff — matches the repair planner).
            if (gitState === "tracked") {
              confirmationRequirements.push({
                id: `confirm:git-delete:${relativeTarget}`,
                kind: "git-projection-delete",
                relativeTarget,
                skillId,
                gitState,
              });
            }
          }
        }
      }

      // Ordered ops + git states for digest stability.
      targetOperations.sort(compareOps);
      const gitStates: PlanGitState[] = [...gitStateByTarget.entries()]
        .map(([relativeTarget, state]) => ({ relativeTarget, state }))
        .sort((a, b) => a.relativeTarget.localeCompare(b.relativeTarget));

      confirmationRequirements.sort((a, b) => a.id.localeCompare(b.id));

      // Duplicate-discovery report (notice, v8.2): both delivery roots plus at
      // least one dual-root projection means multi-root scanners genuinely
      // see the same skill twice. Documented consequence of dual delivery —
      // reported, never a plan/apply blocker.
      if (delivery.agents && delivery.claude && anyDualProjection) {
        const dupKinds = listDuplicateDiscoveryAgentKinds({
          registry: adapterRegistry,
          dualDelivery: true,
        });
        for (const adapterKind of dupKinds) {
          blockingIssues.push(
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

      // applicable: plan must not retain/expand hard blockers.
      // - unmanaged-conflict → a required target is occupied by a foreign
      //   object Pier must not overwrite (design §5.1).
      // - library-drift / missing-source → retained-enabled content no longer
      //   matches the manifest; resolving plans (disable / delete / adopt)
      //   don't emit these.
      // - duplicate-discovery is a notice (v8.2), never blocks applying the
      //   delivery setting that causes it.
      const retainsHardBlocker = blockingIssues.some(
        (i) =>
          i.code === "project-identity-changed" ||
          i.code === "unmanaged-conflict" ||
          i.code === "library-drift" ||
          i.code === "missing-source"
      );
      const applicable = !retainsHardBlocker;

      const planDigest = computePlanDigest({
        normalizedDraft,
        observedRevision,
        targetOperations,
        gitStates,
        confirmationRequirements,
      });

      return {
        observedRevision,
        normalizedDraft,
        targetOperations,
        gitStates,
        confirmationRequirements,
        blockingIssues,
        planDigest,
        applicable,
      };
    },
  };
}
