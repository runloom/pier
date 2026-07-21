import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, resolve } from "node:path";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../shared/contracts/project-skills.ts";
import {
  createSkillDiscoveryAdapterRegistry,
  listUserSkillRoots,
} from "./adapters.ts";
import { expandUserRoot } from "./enumeration.ts";
import type {
  ProjectRootRef as MainProjectRootRef,
  StableProjectIdentity,
} from "./identity.ts";
import {
  assertRealDirectory,
  isErrno,
  isManagedProjection,
  isPathInside,
  isUnderDiscoveryRoot,
  lstatOrThrow,
  normalizeRelativeSource,
  sameFsIdentity,
} from "./import-fs.ts";
import {
  type ImportCallerBinding,
  type ImportCandidateView,
  type OpenDirectoryDialog,
  type PrepareFromSource,
  ProjectSkillsImportError,
  type ProjectSkillsImportPaths,
  type ResolveProject,
} from "./import-limits.ts";

/** Explicit context for local-import / discovery-import entry points. */
export interface ImportSourcesContext {
  defaultCaller: ImportCallerBinding;
  paths: ProjectSkillsImportPaths;
  prepareFromSource: PrepareFromSource;
  resolveProject: ResolveProject;
  showOpenDialog: OpenDirectoryDialog | undefined;
}

async function assertLocalSourceAllowed(
  paths: ProjectSkillsImportPaths,
  args: {
    sourcePath: string;
    identity: StableProjectIdentity;
    rootKey: string;
  }
): Promise<void> {
  const source = resolve(args.sourcePath);
  const sourceInfo = await lstatOrThrow(source);
  assertRealDirectory(sourceInfo, source);

  // Compare against realpath forms so /var vs /private/var cannot bypass checks.
  let sourceReal = source;
  try {
    sourceReal = await realpath(source);
  } catch {
    sourceReal = source;
  }
  const projectReal = args.identity.realPath;
  const pierSkills = join(projectReal, ".pier", "skills");
  if (
    isPathInside(pierSkills, sourceReal) ||
    isPathInside(pierSkills, source)
  ) {
    throw new ProjectSkillsImportError(
      "source-not-allowed",
      "local import source must not be under .pier/skills"
    );
  }

  const stagingDir = paths.stagingDir(args.rootKey);
  let stagingReal = stagingDir;
  try {
    stagingReal = await realpath(stagingDir);
  } catch {
    stagingReal = stagingDir;
  }
  if (
    isPathInside(stagingReal, sourceReal) ||
    isPathInside(stagingDir, source)
  ) {
    throw new ProjectSkillsImportError(
      "source-not-allowed",
      "local import source must not be under staging"
    );
  }

  const libraryDir = join(pierSkills, "library");
  try {
    const libraryInfo = await lstat(libraryDir);
    if (libraryInfo.isDirectory() && sameFsIdentity(sourceInfo, libraryInfo)) {
      throw new ProjectSkillsImportError(
        "source-not-allowed",
        "local import source must not be the target library directory"
      );
    }
    if (
      isPathInside(libraryDir, sourceReal) ||
      isPathInside(libraryDir, source)
    ) {
      throw new ProjectSkillsImportError(
        "source-not-allowed",
        "local import source must not be under library"
      );
    }
  } catch (error) {
    if (
      error instanceof ProjectSkillsImportError ||
      !isErrno(error, "ENOENT")
    ) {
      throw error;
    }
  }
}

export async function prepareLocalImport(
  ctx: ImportSourcesContext,
  projectRef: ContractProjectRootRef | MainProjectRootRef,
  caller?: ImportCallerBinding,
  globalSource?: { root: string; directoryName: string }
): Promise<ImportCandidateView | null> {
  const { identity, rootKey } = await ctx.resolveProject(projectRef);

  if (globalSource) {
    // Preselected entry from the read-only global view (design v8 §6.1):
    // root must be on the registry-derived whitelist; directoryName must be
    // a plain child name. Never an arbitrary renderer path.
    const whitelist = listUserSkillRoots(createSkillDiscoveryAdapterRegistry());
    const allowed = whitelist.some((w) => w.root === globalSource.root);
    if (!allowed) {
      throw new ProjectSkillsImportError(
        "source-not-allowed",
        `global source root is not whitelisted: ${globalSource.root}`
      );
    }
    const name = globalSource.directoryName;
    if (
      !name ||
      name.startsWith(".") ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("..")
    ) {
      throw new ProjectSkillsImportError(
        "source-not-allowed",
        `invalid global source directory name: ${name}`
      );
    }
    const absolute = join(expandUserRoot(globalSource.root, homedir()), name);
    // Global entries installed via symlink managers resolve to their real
    // directory; the copy traversal itself never follows inner symlinks.
    let sourcePath = absolute;
    try {
      sourcePath = await realpath(absolute);
    } catch (error) {
      throw new ProjectSkillsImportError(
        "not-directory",
        `global source does not exist: ${globalSource.root}/${name}`,
        { cause: error }
      );
    }
    await assertLocalSourceAllowed(ctx.paths, {
      sourcePath,
      identity,
      rootKey,
    });
    return ctx.prepareFromSource({
      identity,
      rootKey,
      sourcePath,
      sourceDisplayPath: `${globalSource.root}/${name}`,
      sourceKind: "local-import",
      caller: caller ?? ctx.defaultCaller,
    });
  }

  const dialog = ctx.showOpenDialog;
  if (!dialog) {
    throw new Error(
      "showOpenDialog is required for prepareLocalImport (inject in tests)"
    );
  }
  const result = await dialog();
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const sourcePath = result.filePaths[0]!;
  await assertLocalSourceAllowed(ctx.paths, { sourcePath, identity, rootKey });
  return ctx.prepareFromSource({
    identity,
    rootKey,
    sourcePath,
    sourceDisplayPath: sourcePath,
    sourceKind: "local-import",
    caller: caller ?? ctx.defaultCaller,
  });
}

export async function prepareFromDiscovery(
  ctx: ImportSourcesContext,
  projectRef: ContractProjectRootRef | MainProjectRootRef,
  relativeSource: string,
  caller?: ImportCallerBinding
): Promise<ImportCandidateView> {
  const { identity, rootKey } = await ctx.resolveProject(projectRef);
  const rel = normalizeRelativeSource(relativeSource);
  if (!isUnderDiscoveryRoot(rel)) {
    throw new ProjectSkillsImportError(
      "invalid-relative-source",
      `relativeSource must be under a discovery root: ${rel}`
    );
  }
  // Must be a skill directory (discoveryRoot/<id>), not the root itself.
  const parts = rel.split(posix.sep);
  if (parts.length < 3) {
    throw new ProjectSkillsImportError(
      "invalid-relative-source",
      `relativeSource must point at a skill directory under a discovery root: ${rel}`
    );
  }

  const absolute = join(identity.realPath, ...parts);
  // Refuse path escape after join
  if (!isPathInside(identity.realPath, absolute)) {
    throw new ProjectSkillsImportError(
      "path-escape",
      "relativeSource escapes project root"
    );
  }

  const info = await lstatOrThrow(absolute);
  if (info.isSymbolicLink()) {
    // Discovery import: non-symlink real directories only.
    if (await isManagedProjection(absolute)) {
      throw new ProjectSkillsImportError(
        "managed-projection",
        `refusing managed projection: ${rel}`
      );
    }
    throw new ProjectSkillsImportError(
      "symlink",
      `discovery import source must not be a symlink: ${rel}`
    );
  }
  assertRealDirectory(info, absolute);

  if (await isManagedProjection(absolute)) {
    throw new ProjectSkillsImportError(
      "managed-projection",
      `refusing managed projection: ${rel}`
    );
  }

  return ctx.prepareFromSource({
    identity,
    rootKey,
    sourcePath: absolute,
    sourceDisplayPath: rel,
    sourceKind: "project-discovery-import",
    caller: caller ?? ctx.defaultCaller,
  });
}
