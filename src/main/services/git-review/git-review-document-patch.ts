import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  type ExecGitRaw,
  GIT_EXEC_DIAGNOSTIC_TAIL_BYTES,
  type GitExecRawResult,
} from "../git-exec.ts";
import { parseGitSinglePathOutput } from "../git-path-output.ts";
import {
  createGitReviewPatchState,
  materialFromGitReviewPatchEnvelope,
} from "./git-review-document-envelope.ts";
import {
  type GitReviewPatchEnvelope,
  GitReviewPatchEnvelopeSelector,
  selectGitReviewPatchEnvelope,
} from "./git-review-document-envelope-selector.ts";
import {
  GIT_REVIEW_PATCH_MAX_BYTES,
  GitReviewDocumentProtocolError,
  GitReviewDocumentStaleError,
  type GitReviewPatchMaterial,
  type ReadGitReviewPatchOptions,
} from "./git-review-document-patch-contract.ts";
import { raceGitReviewIdentityBoundary } from "./git-review-identity-boundary.ts";
import {
  type GitReviewIndexExecutionBudget,
  GitReviewIndexExecutionError,
} from "./git-review-index-contract.ts";
import {
  type GitReviewFileFingerprint,
  type GitReviewFileSnapshot,
  GitReviewPathError,
  readGitReviewFileFingerprint,
  readGitReviewFileSnapshot,
} from "./git-review-path-guard.ts";
import {
  createGitReviewExactPathspecs,
  hasGitReviewExactPathspecConflict,
} from "./git-review-pathspec.ts";
import { createGitReviewTemporaryRoot } from "./git-review-temporary-root.ts";
import {
  cleanupGitReviewTemporaryRoot,
  cleanupLateGitReviewTemporaryRoot,
} from "./git-review-temporary-root-cleanup.ts";

export {
  GitReviewDocumentProtocolError,
  GitReviewDocumentStaleError,
  type GitReviewPatchMaterial,
  type GitReviewRenderableGroup,
} from "./git-review-document-patch-contract.ts";

const GIT_REVIEW_DEFAULT_CONTEXT_LINES = 20;
const GIT_REVIEW_PATCH_ENVELOPE_MAX_BYTES =
  GIT_REVIEW_PATCH_MAX_BYTES + GIT_EXEC_DIAGNOSTIC_TAIL_BYTES;

const PATCH_MACHINE_ARGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  `--unified=${GIT_REVIEW_DEFAULT_CONTEXT_LINES}`,
  "--ignore-submodules=none",
  "--find-renames=50%",
  "--find-copies=50%",
  "-l0",
  "--binary",
  "--full-index",
  "--no-abbrev",
  "--patch-with-raw",
  "-z",
] as const;

export async function readGitReviewPatch(
  options: ReadGitReviewPatchOptions
): Promise<GitReviewPatchMaterial> {
  if (options.fact.origin === "untracked") {
    if (options.group !== "unstaged") {
      throw new GitReviewDocumentProtocolError(
        "untracked fact 只能生成 unstaged section"
      );
    }
    return readUntrackedPatch(options);
  }
  if (options.fact.origin === "conflict") {
    throw new GitReviewDocumentProtocolError(
      "conflict fact 不能生成 patch section"
    );
  }
  let before: GitReviewFileFingerprint | null = null;
  if (
    options.group === "unstaged" &&
    options.fact.status !== "deleted" &&
    options.fact.statsExpected
  ) {
    const snapshot = await tryReadFingerprint(options);
    if (snapshot.kind === "state") {
      return snapshot;
    }
    before = snapshot.snapshot;
  }
  const envelope = await collectSelectedPatch(options);
  const material = materialFromGitReviewPatchEnvelope(envelope, options);
  if (before !== null) {
    const after = await tryReadFingerprint(options);
    if (after.kind === "state") {
      throw new GitReviewDocumentStaleError(
        "Git Review worktree 文件在 patch 生成后不可读取"
      );
    }
    if (
      before.digest !== after.snapshot.digest ||
      before.identityToken !== after.snapshot.identityToken
    ) {
      throw new GitReviewDocumentStaleError(
        "Git Review worktree 文件在 patch 生成期间发生变化"
      );
    }
  }
  return material;
}

async function collectSelectedPatch(
  options: ReadGitReviewPatchOptions
): Promise<GitReviewPatchEnvelope> {
  const selector = new GitReviewPatchEnvelopeSelector(options.fact);
  let selectorError: unknown;
  let result: GitExecRawResult;
  try {
    result = await options.execGitRaw(createTrackedPatchArgs(options), {
      budget: options.budget,
      cwd: options.gitRootPath,
      env: { GIT_DIFF_OPTS: "" },
      mode: "chunks",
      onStdoutChunk: (chunk) => {
        try {
          selector.push(chunk);
        } catch (error) {
          selectorError = error;
          throw error;
        }
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (selectorError !== undefined) {
      throw selectorError;
    }
    throw error;
  }
  if (result.kind !== "consumed") {
    throw new GitReviewDocumentProtocolError(
      "Git Review patch 命令返回了非 consume 结果"
    );
  }
  return selector.finish();
}

async function readUntrackedPatch(
  options: ReadGitReviewPatchOptions
): Promise<GitReviewPatchMaterial> {
  const before = await tryReadSnapshot(options);
  if (before.kind === "state") {
    return before;
  }
  if (before.snapshot.bytes.includes(0)) {
    return createGitReviewPatchState("binary", before.snapshot.digest);
  }
  if (!isUtf8(before.snapshot.bytes)) {
    return createGitReviewPatchState("invalidEncoding", before.snapshot.digest);
  }
  const temporaryRootPromise = createGitReviewTemporaryRoot();
  let temporaryRoot: string;
  try {
    temporaryRoot = await raceFilesystemOperation(
      options,
      () => temporaryRootPromise
    );
  } catch (error) {
    cleanupLateGitReviewTemporaryRoot(temporaryRootPromise, options.budget);
    throw error;
  }
  let cleanupError: unknown;
  let material: GitReviewPatchMaterial | undefined;
  let primaryError: unknown;
  try {
    const objectDirectory = join(temporaryRoot, "objects");
    const indexPath = join(temporaryRoot, "index");
    await raceFilesystemOperation(options, () => mkdir(objectDirectory));
    const alternateObjectDirectory = await resolveObjectDirectory(options);
    const env = {
      GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify(
        alternateObjectDirectory
      ),
      GIT_INDEX_FILE: indexPath,
      GIT_OBJECT_DIRECTORY: objectDirectory,
    };
    const emptyTreeOid = await hashObject(options, env, Buffer.alloc(0), [
      "-t",
      "tree",
    ]);
    const blobOid = await hashObject(options, env, before.snapshot.bytes);
    const mode = before.snapshot.executable ? "100755" : "100644";
    await collectGit(
      options.execGitRaw,
      ["--literal-pathspecs", "update-index", "-z", "--index-info"],
      options.gitRootPath,
      options.budget,
      options.signal,
      env,
      Buffer.from(`${mode} ${blobOid}\t${options.fact.targetPath}\0`, "utf8")
    );
    const result = await collectGit(
      options.execGitRaw,
      [
        "--literal-pathspecs",
        "diff",
        ...PATCH_MACHINE_ARGS,
        "--cached",
        emptyTreeOid,
        "--",
        options.fact.targetPath,
      ],
      options.gitRootPath,
      options.budget,
      options.signal,
      env
    );
    material = materialFromGitReviewPatchEnvelope(
      selectGitReviewPatchEnvelope(result.stdout, options.fact),
      options
    );
    const after = await tryReadFingerprint(options);
    if (
      after.kind === "state" ||
      before.snapshot.digest !== after.snapshot.digest ||
      before.snapshot.identityToken !== after.snapshot.identityToken
    ) {
      throw new GitReviewDocumentStaleError(
        "Git Review untracked 文件在 patch 生成期间发生变化"
      );
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      // cleanup 不能复用已经取消的请求 signal，否则目录会被直接遗留；同时
      // 以本地上限避免异常文件系统永久占用调度许可。
      await cleanupGitReviewTemporaryRoot(temporaryRoot, options.budget);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  if (material === undefined) {
    throw new GitReviewDocumentProtocolError(
      "Git Review untracked patch 未产生结果"
    );
  }
  return material;
}

async function resolveObjectDirectory(
  options: ReadGitReviewPatchOptions
): Promise<string> {
  const result = await collectGit(
    options.execGitRaw,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    options.gitRootPath,
    options.budget,
    options.signal
  );
  if (!isUtf8(result.stdout)) {
    throw new GitReviewDocumentProtocolError(
      "Git Review 无法解码 Git common directory"
    );
  }
  const commonDirectory = parseGitSinglePathOutput(
    result.stdout.toString("utf8")
  );
  if (commonDirectory === null) {
    throw new GitReviewDocumentProtocolError(
      "Git Review 未解析到 Git common directory"
    );
  }
  const absoluteCommonDirectory = isAbsolute(commonDirectory)
    ? commonDirectory
    : resolve(options.gitRootPath, commonDirectory);
  return raceFilesystemOperation(options, () =>
    realpath(join(absoluteCommonDirectory, "objects"))
  );
}

async function hashObject(
  options: ReadGitReviewPatchOptions,
  env: Readonly<Record<string, string>>,
  stdin: Buffer,
  extraArgs: readonly string[] = []
): Promise<string> {
  const result = await collectGit(
    options.execGitRaw,
    ["hash-object", "-w", ...extraArgs, "--stdin"],
    options.gitRootPath,
    options.budget,
    options.signal,
    env,
    stdin
  );
  const oid = removeScalarLineEnding(result.stdout.toString("ascii"));
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)) {
    throw new GitReviewDocumentProtocolError(
      "Git Review hash-object 返回了非法 OID"
    );
  }
  return oid;
}

function createTrackedPatchArgs(
  options: ReadGitReviewPatchOptions
): readonly string[] {
  const paths = uniquePaths(options.fact.oldPath, options.fact.targetPath);
  const pathspecConflict = hasGitReviewExactPathspecConflict(paths);
  const pathspecs = pathspecConflict
    ? paths.map((path) => `:(top,literal)${path}`)
    : createGitReviewExactPathspecs(paths);
  const movementFilter =
    options.fact.movement === null
      ? []
      : [`--diff-filter=${options.fact.movement === "copy" ? "C" : "R"}`];
  if (options.group === "unstaged") {
    return [
      "diff",
      ...PATCH_MACHINE_ARGS,
      ...movementFilter,
      "--",
      ...pathspecs,
    ];
  }
  if (options.group === "staged") {
    return [
      "diff",
      ...PATCH_MACHINE_ARGS,
      "--cached",
      ...(options.headOid === null ? [] : [options.headOid]),
      ...movementFilter,
      "--",
      ...pathspecs,
    ];
  }
  const exhaustive: never = options.group;
  return exhaustive;
}

function raceFilesystemOperation<T>(
  options: ReadGitReviewPatchOptions,
  operation: () => Promise<T>
): Promise<T> {
  return raceGitReviewIdentityBoundary(operation, {
    budget: options.budget,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

async function tryReadSnapshot(
  options: ReadGitReviewPatchOptions
): Promise<
  | { readonly kind: "snapshot"; readonly snapshot: GitReviewFileSnapshot }
  | Extract<GitReviewPatchMaterial, { kind: "state" }>
> {
  try {
    return {
      kind: "snapshot",
      snapshot: await readGitReviewFileSnapshot({
        budget: options.budget,
        gitRootPath: options.gitRootPath,
        path: options.fact.targetPath,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    };
  } catch (error) {
    return pathErrorToSnapshotResult(error, options);
  }
}

async function tryReadFingerprint(
  options: ReadGitReviewPatchOptions
): Promise<
  | { readonly kind: "snapshot"; readonly snapshot: GitReviewFileFingerprint }
  | Extract<GitReviewPatchMaterial, { kind: "state" }>
> {
  try {
    return {
      kind: "snapshot",
      snapshot: await readGitReviewFileFingerprint({
        budget: options.budget,
        gitRootPath: options.gitRootPath,
        path: options.fact.targetPath,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    };
  } catch (error) {
    return pathErrorToSnapshotResult(error, options);
  }
}

function pathErrorToSnapshotResult(
  error: unknown,
  options: ReadGitReviewPatchOptions
): Extract<GitReviewPatchMaterial, { kind: "state" }> {
  if (!(error instanceof GitReviewPathError)) {
    throw error;
  }
  if (error.reason === "changed" || error.reason === "missing") {
    throw new GitReviewDocumentStaleError(error.message, { cause: error });
  }
  if (error.reason === "aborted") {
    const budgetFailure = options.budget.failureReason();
    if (budgetFailure !== null) {
      throw new GitReviewIndexExecutionError(
        budgetFailure,
        `Git Review 文件读取 ${budgetFailure}`
      );
    }
    throw new GitReviewIndexExecutionError(
      "aborted",
      "Git Review 文件读取已取消"
    );
  }
  let reason: "readError" | "symlink" | "tooLarge" = "readError";
  if (error.reason === "symlink") {
    reason = "symlink";
  } else if (error.reason === "tooLarge") {
    reason = "tooLarge";
  }
  return createGitReviewPatchState(
    reason,
    createHash("sha256").update(error.message).digest("hex")
  );
}

async function collectGit(
  execGitRaw: ExecGitRaw,
  args: readonly string[],
  cwd: string,
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal | undefined,
  env?: Readonly<Record<string, string>>,
  stdin?: Buffer
): Promise<Extract<GitExecRawResult, { kind: "collected" }>> {
  const result = await execGitRaw(args, {
    budget,
    cwd,
    env: { GIT_DIFF_OPTS: "", ...env },
    maxOutputBytes: GIT_REVIEW_PATCH_ENVELOPE_MAX_BYTES,
    mode: "collect",
    ...(signal === undefined ? {} : { signal }),
    ...(stdin === undefined ? {} : { stdin }),
  });
  if (result.kind !== "collected") {
    throw new GitReviewDocumentProtocolError(
      "Git Review patch 命令返回了非 collect 结果"
    );
  }
  return result;
}

function uniquePaths(oldPath: string | null, targetPath: string): string[] {
  return oldPath === null || oldPath === targetPath
    ? [targetPath]
    : [oldPath, targetPath];
}

function removeScalarLineEnding(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}
