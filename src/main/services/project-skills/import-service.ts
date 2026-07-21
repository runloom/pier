import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../shared/contracts/project-skills.ts";
import {
  parseSafeSkillFrontmatter as parseSharedSkillFrontmatter,
  SkillFrontmatterError,
} from "./frontmatter.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
} from "./identity.ts";
import {
  type ImportComposeContext,
  prepareContentUpdate as prepareContentUpdateWith,
  prepareDriftAcceptance as prepareDriftAcceptanceWith,
  prepareTemplate as prepareTemplateWith,
} from "./import-compose.ts";
import {
  defaultCallerBinding,
  directoryTotalBytes,
  isErrno,
} from "./import-fs.ts";
import {
  type CreateProjectSkillsImportServiceOptions,
  type ImportCallerBinding,
  type ImportCandidateView,
  PROJECT_SKILLS_IMPORT_LIMITS,
  type PrepareFromSourceArgs,
  ProjectSkillsImportError,
  type ProjectSkillsImportService,
} from "./import-limits.ts";
import {
  type BoundCandidate,
  prepareFromSource as prepareFromSourceImpl,
} from "./import-prepare.ts";
import {
  type ImportSourcesContext,
  prepareFromDiscovery as prepareFromDiscoveryWith,
  prepareLocalImport as prepareLocalImportWith,
} from "./import-sources.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import {
  createProjectSkillsStore,
  type StagingCandidateRecord,
} from "./store.ts";

export type {
  CreateProjectSkillsImportServiceOptions,
  ImportCallerBinding,
  ImportCandidateView,
  ImportDirectorySummary,
  ImportRiskSummary,
  ImportSourceKind,
  OpenDirectoryDialog,
  OpenDirectoryDialogResult,
  ProjectSkillsImportErrorCode,
  ProjectSkillsImportService,
} from "./import-limits.ts";
export {
  PROJECT_SKILLS_DISCOVERY_ROOTS,
  PROJECT_SKILLS_IMPORT_LIMITS,
  ProjectSkillsImportError,
} from "./import-limits.ts";

function normalizeProjectRef(
  projectRef: ContractProjectRootRef | MainProjectRootRef
): {
  realPath: string;
  volumeIdentity: string;
  directoryIdentity: string;
  token?: string;
} {
  if ("identity" in projectRef && projectRef.identity) {
    return {
      realPath: projectRef.realPath,
      volumeIdentity: projectRef.identity.volumeId,
      directoryIdentity: projectRef.identity.directoryIdentity,
      ...(projectRef.token === undefined ? {} : { token: projectRef.token }),
    };
  }
  const flat = projectRef as ContractProjectRootRef;
  return {
    realPath: flat.realPath,
    volumeIdentity: flat.volumeIdentity,
    directoryIdentity: flat.directoryIdentity,
    ...(flat.token === undefined ? {} : { token: flat.token }),
  };
}

/**
 * Restricted YAML frontmatter parser (design §6.1). The implementation lives
 * in `frontmatter.ts` (shared with snapshot widening and the global read-only
 * view); this wrapper preserves the import-service error contract.
 */
export function parseSafeSkillFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  try {
    return parseSharedSkillFrontmatter(markdown);
  } catch (error) {
    if (error instanceof SkillFrontmatterError) {
      throw new ProjectSkillsImportError("frontmatter-invalid", error.message, {
        cause: error,
      });
    }
    throw error;
  }
}

export function createProjectSkillsImportService(
  options: CreateProjectSkillsImportServiceOptions
): ProjectSkillsImportService {
  const paths = createProjectSkillsPaths(options.userData);
  const store =
    options.store ?? createProjectSkillsStore({ userData: options.userData });
  const now = options.now ?? Date.now;
  const defaultCaller = options.defaultCaller ?? defaultCallerBinding();
  const bindings = new Map<string, BoundCandidate>();

  async function withProjectLock<T>(
    identity: StableProjectIdentity,
    rootKey: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!options.lock) return await fn();
    return await options.lock.runExclusive(
      identity,
      [
        identity.realPath,
        paths.projectDir(rootKey),
        join(identity.realPath, ".pier"),
        join(identity.realPath, ".agents"),
      ],
      fn
    );
  }

  async function resolveProject(
    projectRef: ContractProjectRootRef | MainProjectRootRef
  ): Promise<{ identity: StableProjectIdentity; rootKey: string }> {
    const normalized = normalizeProjectRef(projectRef);
    const identity = await resolveStableProjectIdentity(normalized.realPath);
    if (
      identity.volumeId !== normalized.volumeIdentity ||
      identity.directoryIdentity !== normalized.directoryIdentity
    ) {
      throw new ProjectSkillsImportError(
        "identity-mismatch",
        "projectRef identity does not match real path"
      );
    }
    // Prefer live identity realPath.
    return {
      identity: { ...identity, realPath: identity.realPath },
      rootKey: paths.rootKeyFor(identity),
    };
  }

  function stagingTreePathFor(rootKey: string, token: string): string {
    return join(paths.stagingDir(rootKey), token, "tree");
  }

  async function destroyStaging(rootKey: string, token: string): Promise<void> {
    const treeParent = join(paths.stagingDir(rootKey), token);
    // Secure the discard state before deleting bytes. Under the shared
    // project lock this cannot race AVAILABLE → CLAIMED in apply.
    await store.discardAvailable(rootKey, token);
    await rm(treeParent, { force: true, recursive: true });
    bindings.delete(token);
  }

  async function listStagingTokens(rootKey: string): Promise<string[]> {
    const dir = paths.stagingDir(rootKey);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw error;
    }
    return names
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length));
  }

  async function reclaimExpiredCandidates(
    identity: StableProjectIdentity,
    rootKey: string
  ): Promise<void> {
    const tokens = await listStagingTokens(rootKey);
    const ts = now();
    for (const token of tokens) {
      let record: StagingCandidateRecord | null;
      try {
        record = await store.readCandidate(rootKey, token);
      } catch {
        continue;
      }
      if (!record) continue;
      if (record.state !== "AVAILABLE" && record.state !== "RELEASED") continue;
      if (record.expiresAt > ts) continue;
      await withProjectLock(identity, rootKey, async () => {
        const live = await store.readCandidate(rootKey, token);
        if (
          live &&
          (live.state === "AVAILABLE" || live.state === "RELEASED") &&
          live.expiresAt <= now()
        ) {
          await destroyStaging(rootKey, token);
        }
      });
    }
  }

  async function assertStagingQuota(
    identity: StableProjectIdentity,
    rootKey: string,
    incomingBytes: number
  ): Promise<void> {
    const stagingDir = paths.stagingDir(rootKey);
    let used = await directoryTotalBytes(stagingDir);
    if (
      used + incomingBytes <=
      PROJECT_SKILLS_IMPORT_LIMITS.stagingQuotaBytes
    ) {
      return;
    }
    await reclaimExpiredCandidates(identity, rootKey);
    used = await directoryTotalBytes(stagingDir);
    if (used + incomingBytes > PROJECT_SKILLS_IMPORT_LIMITS.stagingQuotaBytes) {
      throw new ProjectSkillsImportError(
        "quota-exceeded",
        `staging quota ${PROJECT_SKILLS_IMPORT_LIMITS.stagingQuotaBytes} exceeded`
      );
    }
  }

  async function prepareFromSource(
    args: PrepareFromSourceArgs
  ): Promise<ImportCandidateView> {
    return await prepareFromSourceImpl(
      {
        assertStagingQuota,
        bindings,
        now,
        options,
        parseSafeSkillFrontmatter,
        paths,
        stagingTreePathFor,
        store,
      },
      args
    );
  }

  async function discardImport(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    token: string,
    caller?: ImportCallerBinding
  ): Promise<void> {
    if (
      !token ||
      token.includes("/") ||
      token.includes("\\") ||
      token.includes("..")
    ) {
      return;
    }
    const { identity, rootKey } = await resolveProject(projectRef);
    const bound = bindings.get(token);
    if (bound) {
      if (
        bound.projectIdentity.directoryIdentity !==
          identity.directoryIdentity ||
        bound.projectIdentity.volumeId !== identity.volumeId
      ) {
        // Wrong project — treat as no-op for idempotence (token not in this project).
        return;
      }
      const activeCaller = caller ?? defaultCaller;
      // Binding mismatch: still allow discard of AVAILABLE via store for the
      // owning project when caller is omitted in recovery paths; if caller is
      // explicitly provided and mismatches, no-op (do not leak cross-window).
      if (
        caller &&
        (bound.webContentsId !== activeCaller.webContentsId ||
          bound.clientInstanceId !== activeCaller.clientInstanceId)
      ) {
        return;
      }
    }

    await withProjectLock(identity, rootKey, async () => {
      const record = await store.readCandidate(rootKey, token);
      if (!record) {
        // Idempotent: clear an orphan tree only while holding the same lock
        // that protects candidate creation/claim/discard transitions.
        await rm(join(paths.stagingDir(rootKey), token), {
          force: true,
          recursive: true,
        }).catch(() => undefined);
        bindings.delete(token);
        return;
      }
      if (record.state !== "AVAILABLE" && record.state !== "RELEASED") {
        return;
      }
      await destroyStaging(rootKey, token);
    });
  }

  function resolveStagingTreePath(token: string): string | null {
    return bindings.get(token)?.stagingTreePath ?? null;
  }

  const composeCtx: ImportComposeContext = {
    defaultCaller,
    now,
    paths,
    prepareFromSource,
    resolveProject,
    store,
  };
  const sourcesCtx: ImportSourcesContext = {
    defaultCaller,
    paths,
    prepareFromSource,
    resolveProject,
    showOpenDialog: options.showOpenDialog,
  };

  return {
    prepareLocalImport: (projectRef, caller, globalSource) =>
      prepareLocalImportWith(sourcesCtx, projectRef, caller, globalSource),
    prepareFromDiscovery: (projectRef, relativeSource, caller) =>
      prepareFromDiscoveryWith(sourcesCtx, projectRef, relativeSource, caller),
    prepareTemplate: (projectRef, args, caller) =>
      prepareTemplateWith(composeCtx, projectRef, args, caller),
    prepareContentUpdate: (projectRef, args, caller) =>
      prepareContentUpdateWith(composeCtx, projectRef, args, caller),
    prepareDriftAcceptance: (projectRef, args, caller) =>
      prepareDriftAcceptanceWith(composeCtx, projectRef, args, caller),
    discardImport,
    resolveStagingTreePath,
  };
}
