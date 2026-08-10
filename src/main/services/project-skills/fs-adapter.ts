import { randomUUID } from "node:crypto";
import { type BigIntStats, constants, type Stats } from "node:fs";
import {
  access,
  lstat,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { defaultRenameExclusive } from "./fs-rename-exclusive.ts";
import { assertProjectRelativeAncestorsReal } from "./path-containment.ts";

export type {
  FsObjectIdentity,
  ProjectSkillsFileSystemAdapter,
  ProjectSkillsFileSystemAdapterOptions,
  PublishFileExpectedState,
  PublishFileReplaceArgs,
  PublishNoReplaceResult,
  PublishReplaceReviewResult,
} from "./fs-adapter-types.ts";

import type {
  FsObjectIdentity,
  ProjectSkillsFileSystemAdapter,
  ProjectSkillsFileSystemAdapterOptions,
  PublishFileExpectedState,
} from "./fs-adapter-types.ts";

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function isMissingPathError(error: unknown): boolean {
  return isErrno(error, "ENOENT");
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function identityFromStats(info: Stats | BigIntStats): FsObjectIdentity {
  const identity: FsObjectIdentity = {
    dev: toNumber(info.dev),
    ino: toNumber(info.ino),
    isDirectory: info.isDirectory(),
    isSymbolicLink: info.isSymbolicLink(),
    mode: toNumber(info.mode),
    nlink: toNumber(info.nlink),
  };
  if ("birthtimeNs" in info && info.birthtimeNs !== undefined) {
    identity.birthtimeNs =
      typeof info.birthtimeNs === "bigint"
        ? info.birthtimeNs
        : BigInt(Math.round(Number(info.birthtimeNs)));
  }
  return identity;
}

function sameIdentity(
  left: FsObjectIdentity,
  right: FsObjectIdentity
): boolean {
  if (
    left.dev !== right.dev ||
    left.ino !== right.ino ||
    left.mode !== right.mode ||
    left.nlink !== right.nlink ||
    left.isDirectory !== right.isDirectory ||
    left.isSymbolicLink !== right.isSymbolicLink
  ) {
    return false;
  }
  if (left.birthtimeNs === undefined || right.birthtimeNs === undefined) {
    return true;
  }
  return left.birthtimeNs === right.birthtimeNs;
}

function assertRelativeSymlinkTarget(relativeTarget: string): void {
  if (relativeTarget.length === 0) {
    throw new Error("relative symlink target must not be empty");
  }
  if (isAbsolute(relativeTarget)) {
    throw new Error("symlink target must be relative");
  }
  if (relativeTarget.includes("\0")) {
    throw new Error("symlink target must not contain NUL");
  }
}

async function defaultSyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readIdentity(path: string): Promise<FsObjectIdentity> {
  try {
    return identityFromStats(await lstat(path, { bigint: true }));
  } catch (error) {
    if (
      error instanceof Error &&
      /bigint|birthtimeNs|unknown/i.test(error.message)
    ) {
      return identityFromStats(await lstat(path));
    }
    throw error;
  }
}

async function parentIsRealDirectory(parentPath: string): Promise<boolean> {
  try {
    const info = await lstat(parentPath);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function matchesExpectedPresent(args: {
  path: string;
  expected: Extract<PublishFileExpectedState, { kind: "present" }>;
  digestOf: (bytes: Buffer) => string;
}): Promise<"match" | "missing" | "changed"> {
  try {
    const identity = await readIdentity(args.path);
    if (!sameIdentity(identity, args.expected.identity)) {
      return "changed";
    }
    if (identity.isDirectory || identity.isSymbolicLink) {
      return "changed";
    }
    const digest = args.digestOf(await readFile(args.path));
    return digest === args.expected.digest ? "match" : "changed";
  } catch (error) {
    if (isMissingPathError(error)) {
      return "missing";
    }
    throw error;
  }
}

export function createProjectSkillsFileSystemAdapter(
  options: ProjectSkillsFileSystemAdapterOptions = {}
): ProjectSkillsFileSystemAdapter {
  const renameExclusive = options.renameExclusive ?? defaultRenameExclusive;
  const renameFile = options.renameFile ?? rename;
  const syncDirectoryImpl = options.syncDirectory ?? defaultSyncDirectory;

  return {
    async lstatIdentity(path) {
      return await readIdentity(path);
    },

    async probeCapabilities(rootPath) {
      const resolvedRoot = resolve(rootPath);
      let writable = false;
      let supportsNoFollow = false;
      let supportsDirSync = false;

      try {
        await access(
          resolvedRoot,
          // biome-ignore lint/suspicious/noBitwiseOperators: fs access mask
          constants.W_OK | constants.R_OK | constants.X_OK
        );
        writable = true;
      } catch {
        writable = false;
      }

      const probeFile = resolve(
        resolvedRoot,
        `.pier-skills-probe-${process.pid}-${randomUUID()}`
      );
      try {
        if (writable) {
          const handle = await open(
            probeFile,
            // biome-ignore lint/suspicious/noBitwiseOperators: fs open flags
            constants.O_CREAT |
              constants.O_EXCL |
              constants.O_WRONLY |
              constants.O_NOFOLLOW,
            0o600
          );
          try {
            await handle.writeFile(Buffer.from("ok\n"));
            await handle.sync();
            supportsNoFollow = true;
          } finally {
            await handle.close();
          }
          try {
            await syncDirectoryImpl(resolvedRoot);
            supportsDirSync = true;
          } catch {
            supportsDirSync = false;
          }
        } else {
          supportsNoFollow = typeof constants.O_NOFOLLOW === "number";
        }
      } catch {
        supportsNoFollow = typeof constants.O_NOFOLLOW === "number";
        supportsDirSync = false;
      } finally {
        await rm(probeFile, { force: true }).catch(() => undefined);
      }

      return {
        kind:
          writable && supportsNoFollow && supportsDirSync
            ? "local-reliable"
            : "unsupported",
        supportsDirSync,
        supportsNoFollow,
        writable,
      };
    },

    async publishSymlinkNoReplace(args) {
      assertRelativeSymlinkTarget(args.relativeTarget);
      const linkPath = resolve(args.linkPath);
      const parentPath = dirname(linkPath);

      if (!(await parentIsRealDirectory(parentPath))) {
        return { reason: "parent-invalid", status: "conflict" };
      }

      if (args.projectRoot !== undefined) {
        const projectRoot = resolve(args.projectRoot);
        const relFromRoot = relative(projectRoot, linkPath);
        if (
          relFromRoot.length === 0 ||
          relFromRoot.startsWith(`..${sep}`) ||
          relFromRoot === ".." ||
          isAbsolute(relFromRoot)
        ) {
          return { reason: "parent-invalid", status: "conflict" };
        }
        const parentRel = dirname(relFromRoot).split(sep).join("/");
        if (parentRel !== "." && parentRel !== "") {
          try {
            await assertProjectRelativeAncestorsReal(projectRoot, parentRel);
          } catch {
            return { reason: "parent-invalid", status: "conflict" };
          }
        }
      }

      try {
        await lstat(linkPath);
        return { reason: "target-exists", status: "conflict" };
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }

      const temporaryPath = resolve(
        parentPath,
        `.pier-skills-link-${process.pid}-${randomUUID()}.tmp`
      );

      try {
        await symlink(args.relativeTarget, temporaryPath);
        try {
          await renameExclusive(temporaryPath, linkPath);
        } catch (error) {
          if (isErrno(error, "EEXIST")) {
            return { reason: "target-exists", status: "conflict" };
          }
          throw error;
        }
        return {
          identity: await readIdentity(linkPath),
          status: "created",
        };
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    },

    async publishFileReplaceIfUnchanged(args) {
      const targetPath = resolve(args.path);
      const parentPath = dirname(targetPath);
      if (!(await parentIsRealDirectory(parentPath))) {
        throw new Error(`parent directory is invalid: ${parentPath}`);
      }

      const temporaryPath = resolve(
        parentPath,
        `.pier-skills-file-${process.pid}-${randomUUID()}.tmp`
      );

      try {
        await writeFile(temporaryPath, args.bytes, { flag: "wx", mode: 0o644 });
        const tempHandle = await open(temporaryPath, "r+");
        try {
          await tempHandle.sync();
        } finally {
          await tempHandle.close();
        }

        // Test seam for races around the final expectation check window.
        await args.beforePublish?.();

        if (args.expected.kind === "absent") {
          try {
            await lstat(targetPath);
            return { reason: "target-changed", status: "conflict" };
          } catch (error) {
            if (!isMissingPathError(error)) {
              throw error;
            }
          }
        } else {
          const check = await matchesExpectedPresent({
            digestOf: args.digestOf,
            expected: args.expected,
            path: targetPath,
          });
          if (check === "missing") {
            return { reason: "target-missing", status: "conflict" };
          }
          if (check === "changed") {
            return { reason: "target-changed", status: "conflict" };
          }
        }

        // Commit point. Existing-target replace uses ordinary atomic rename;
        // absent targets use exclusive publish. Post-check reviews the result.
        // This is a conservative final-check + replace + review model, not
        // strong CAS against uncooperative writers.
        if (args.expected.kind === "absent") {
          try {
            await renameExclusive(temporaryPath, targetPath);
          } catch (error) {
            if (isErrno(error, "EEXIST")) {
              return { reason: "target-changed", status: "conflict" };
            }
            throw error;
          }
        } else {
          await renameFile(temporaryPath, targetPath);
        }

        try {
          await syncDirectoryImpl(parentPath);
        } catch {
          return { reason: "sync-unknown", status: "indeterminate" };
        }

        try {
          const identity = await readIdentity(targetPath);
          if (identity.isDirectory || identity.isSymbolicLink) {
            return { reason: "post-check-diverged", status: "indeterminate" };
          }
          const digest = args.digestOf(await readFile(targetPath));
          if (digest !== args.digestOf(args.bytes)) {
            return { reason: "post-check-diverged", status: "indeterminate" };
          }
          return {
            identity,
            postCheck: "matched",
            status: "replaced",
          };
        } catch {
          return { reason: "post-check-diverged", status: "indeterminate" };
        }
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    },

    async syncDirectory(path) {
      await syncDirectoryImpl(resolve(path));
    },
  };
}
