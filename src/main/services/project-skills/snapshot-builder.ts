import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentKind } from "../../../shared/contracts/agent.ts";
import {
  type ProjectRootRef as ContractProjectRootRef,
  type ProjectSkillsManifest,
  type ProjectSkillView,
  projectSkillsManifestSchema,
  type SkillEffectiveCell,
  type UnmanagedSkillView,
  type UserGlobalSkillView,
} from "../../../shared/contracts/project-skills.ts";
import type { SkillDiscoveryAdapterRegistry } from "./adapters.ts";
import {
  deriveEffectiveMatrix,
  deriveUserGlobalEffects,
  type MatrixManagedSkill,
  type MatrixUnmanagedSkill,
  unmanagedKey,
} from "./effective-matrix.ts";
import {
  enumerateProjectDiscoveryRoots,
  enumerateUserGlobalSkills,
} from "./enumeration.ts";
import { peekSkillMetadata } from "./frontmatter.ts";
import {
  buildProjectSkillsIssue,
  type ProjectSkillsHealthService,
  type SnapshotHealth,
} from "./health.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "./identity.ts";
import { inspectLibraryContent } from "./library-state.ts";
import type { createProjectSkillsPaths } from "./paths.ts";
import { analyzeLibrarySkill } from "./risk.ts";
import type { ProjectSkillsStore } from "./store.ts";
import type { SystemSkillsChannel } from "./system-skills.ts";

/**
 * Snapshot assembly (design v8 §3.6 / §5.1), split from service.ts
 * (file-size cap). Behavior unchanged.
 */

export interface ProjectSkillsProjectSummary {
  checkedAt: number;
  displayPath: string;
  projectRef: ContractProjectRootRef;
  readStatus: "ok" | "missing-manifest" | "invalid-manifest" | "error";
  skillCount: number;
  source: "panel" | "environment" | "unknown";
}

export interface ProjectSkillsSnapshot {
  checkedAt: number;
  health: SnapshotHealth;
  manifest: ProjectSkillsManifest | null;
  manifestRevision: string | null;
  observedRevision: string;
  projectRef: ContractProjectRootRef;
  recentOperations: Array<{
    operationId: string;
    status: string;
  }>;
  skills: ProjectSkillView[];
  unmanagedSkills: UnmanagedSkillView[];
  /** Layer-3 read-only rows for the unified list (design v8 §7.3 / §7.6). */
  userGlobalSkills: UserGlobalSkillView[];
}

function digestBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function readManifestFile(
  projectRoot: string
): Promise<
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "present"; manifest: ProjectSkillsManifest; revision: string }
> {
  try {
    const bytes = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json")
    );
    const revision = digestBytes(bytes);
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { status: "invalid" };
    }
    const parsed = projectSkillsManifestSchema.safeParse(json);
    if (!parsed.success) return { status: "invalid" };
    return { status: "present", manifest: parsed.data, revision };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return { status: "absent" };
    }
    return { status: "invalid" };
  }
}

export interface SnapshotBuilderCtx {
  getObservedRevision: (projectRoot: string) => Promise<string>;
  healthService: ProjectSkillsHealthService;
  now: () => number;
  paths: ReturnType<typeof createProjectSkillsPaths>;
  readInstalledAgents: () => Promise<ReadonlySet<string> | undefined>;
  registry: SkillDiscoveryAdapterRegistry;
  store: ProjectSkillsStore;
  systemSkills?: SystemSkillsChannel | undefined;
}

export async function buildProjectSnapshot(
  ctx: SnapshotBuilderCtx,
  ref: ContractProjectRootRef | MainProjectRootRef
): Promise<ProjectSkillsSnapshot> {
  const {
    paths,
    store,
    registry,
    healthService,
    now,
    getObservedRevision,
    readInstalledAgents,
  } = ctx;
  const checkedAt = now();
  const claimed =
    "identity" in ref
      ? ref.identity
      : {
          realPath: ref.realPath,
          volumeId: ref.volumeIdentity,
          directoryIdentity: ref.directoryIdentity,
        };
  const live = await resolveStableProjectIdentity(claimed.realPath);
  const projectRef = toContractProjectRootRef(live);
  const health = await healthService.doctor(projectRef);
  const observedRevision = await getObservedRevision(live.realPath);
  const manifestState = await readManifestFile(live.realPath);
  const rootKey = paths.rootKeyFor(live);
  // v9 ignores any legacy approvals.json; do not mutate userData on snapshot
  // reads (migration cleanup belongs on write/ensure paths if ever needed).

  let ownership: Awaited<ReturnType<typeof store.readOwnership>> = null;
  try {
    ownership = await store.readOwnership(rootKey);
  } catch {
    ownership = null;
  }

  // Layer enumeration for the effective matrix.
  const presence = await enumerateProjectDiscoveryRoots({
    projectRoot: live.realPath,
    ownership,
  });
  // Metadata (SKILL.md frontmatter) feeds the unified list's user-global
  // rows; the peek is bounded, so withMetadata is safe here.
  const userGlobal = await enumerateUserGlobalSkills({
    registry,
    withMetadata: true,
  });
  const installedAgents = await readInstalledAgents();

  const manifestEntries =
    manifestState.status === "present" ? manifestState.manifest.skills : [];
  const systemViews = ctx.systemSkills
    ? await ctx.systemSkills.views(rootKey)
    : [];
  const systemIds = new Set(systemViews.map((v) => v.id));

  const matrixManaged: MatrixManagedSkill[] = [];
  for (const entry of manifestEntries) {
    matrixManaged.push({
      skillId: entry.id,
      enabled: entry.enabled,
      projectedRoots: presence.ownedProjectedRoots.get(entry.id) ?? [],
    });
  }
  for (const view of systemViews) {
    if (manifestEntries.some((e) => e.id === view.id)) continue;
    matrixManaged.push({
      skillId: view.id,
      enabled: view.enabled,
      projectedRoots: presence.ownedProjectedRoots.get(view.id) ?? [],
    });
  }

  const matrixUnmanaged: MatrixUnmanagedSkill[] = presence.unmanaged.map(
    (u) => ({ root: u.root, directoryName: u.directoryName })
  );

  const matrix = deriveEffectiveMatrix({
    registry,
    managed: matrixManaged,
    unmanaged: matrixUnmanaged,
    userGlobal: userGlobal.entries,
    ...(installedAgents === undefined ? {} : { installedAgents }),
  });

  // Layer-3 shadowing notices (never blocking).
  for (const shadow of matrix.shadowedManaged) {
    health.issues.push(
      buildProjectSkillsIssue({
        code: "shadowed-by-user-skill",
        scope: "skill",
        skillId: shadow.skillId,
        adapterKind: shadow.agentKind as AgentKind,
        checkedAt,
        evidence: { userRoot: shadow.userRoot },
      })
    );
  }

  const skills: ProjectSkillView[] = [];
  for (const entry of manifestEntries) {
    const libraryDir = join(
      live.realPath,
      ".pier",
      "skills",
      "library",
      entry.id
    );
    const meta = await peekSkillMetadata(libraryDir);
    const analysis = await analyzeLibrarySkill(live.realPath, entry.id);
    // The manifest digest is the expected library content. A mismatched or
    // missing tree must surface on the row and detail banner, with the actual
    // digest exposed so the UI can offer "Use current files".
    let actualContentDigest: string | null = null;
    if (!systemIds.has(entry.id)) {
      const inspection = await inspectLibraryContent(
        live.realPath,
        entry.id,
        entry.contentDigest
      );
      // Doctor owns missing-source / library-drift issues; snapshot only
      // surfaces the actual digest without doubling the same issue id.
      if (inspection.state === "drifted" || inspection.state === "unreadable") {
        actualContentDigest = inspection.actualDigest;
      }
    }
    const issueIds = health.issues
      .filter((i) => i.skillId === entry.id)
      .map((i) => i.id);
    skills.push({
      id: entry.id,
      name: meta.name,
      description: meta.description,
      enabled: entry.enabled,
      contentDigest: entry.contentDigest,
      actualContentDigest,
      source: entry.source,
      managedBy: systemIds.has(entry.id) ? "pier-system" : "user",
      fileCount: analysis?.fileCount ?? 0,
      totalBytes: analysis?.totalBytes ?? 0,
      riskSummary: analysis?.riskSummary ?? null,
      directorySummary: analysis?.directorySummary ?? null,
      effects: matrix.managedEffects.get(entry.id) ?? [],
      issueIds,
    });
  }
  for (const view of systemViews) {
    if (skills.some((s) => s.id === view.id)) continue;
    const libraryDir = join(
      live.realPath,
      ".pier",
      "skills",
      "library",
      view.id
    );
    const meta = await peekSkillMetadata(libraryDir);
    const analysis = await analyzeLibrarySkill(live.realPath, view.id);
    // System rows reconcile to the contribution content; the live library
    // digest IS the published digest (the channel republishes divergence).
    const systemContent = await inspectLibraryContent(
      live.realPath,
      view.id,
      view.contentDigest ?? ""
    );
    skills.push({
      id: view.id,
      name: meta.name,
      description: meta.description,
      enabled: view.enabled,
      contentDigest: view.contentDigest ?? systemContent.actualDigest ?? "",
      actualContentDigest: null,
      source: { type: "local-import" },
      managedBy: "pier-system",
      fileCount: analysis?.fileCount ?? 0,
      totalBytes: analysis?.totalBytes ?? 0,
      riskSummary: analysis?.riskSummary ?? null,
      directorySummary: analysis?.directorySummary ?? null,
      effects: matrix.managedEffects.get(view.id) ?? [],
      issueIds: [],
    });
  }

  const unmanagedSkills: UnmanagedSkillView[] = presence.unmanaged.map((u) => ({
    root: u.root,
    directoryName: u.directoryName,
    name: u.name,
    description: u.description,
    kind: u.kind,
    effects:
      matrix.unmanagedEffects.get(unmanagedKey(u.root, u.directoryName)) ??
      ([] as SkillEffectiveCell[]),
  }));

  const userGlobalSkills: UserGlobalSkillView[] = userGlobal.entries.map(
    (entry) => ({
      root: entry.root,
      directoryName: entry.directoryName,
      name: entry.name,
      description: entry.description,
      effects: deriveUserGlobalEffects({
        registry,
        root: entry.root,
        directoryName: entry.directoryName,
        managed: matrixManaged,
        unmanaged: matrixUnmanaged,
        installedAgents,
      }),
    })
  );

  return {
    projectRef,
    manifestRevision:
      manifestState.status === "present" ? manifestState.revision : null,
    observedRevision,
    manifest:
      manifestState.status === "present" ? manifestState.manifest : null,
    skills,
    unmanagedSkills,
    userGlobalSkills,
    health,
    recentOperations: [], // v1: deferred — operations dir is for recovery, not a UI timeline
    checkedAt,
  };
}
