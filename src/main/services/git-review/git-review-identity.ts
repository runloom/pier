import { realpath as fsRealpath } from "node:fs/promises";
import { type ExecGitRaw, execGitRaw, GitExecRawError } from "../git-exec.ts";
import {
  assertGitReviewIdentityExecutionOptions,
  forwardGitReviewIdentityAbort,
  raceGitReviewIdentityBoundary,
} from "./git-review-identity-boundary.ts";
import {
  type CreateGitReviewIdentityResolverOptions,
  type GitReviewBranchIdentity,
  type GitReviewCommitIdentity,
  GitReviewIdentityError,
  type GitReviewIdentityExecutionOptions,
  type GitReviewObjectFormat,
  type GitReviewRepositoryBaseIdentity,
  type GitReviewRepositoryIdentity,
} from "./git-review-identity-contract.ts";

export * from "./git-review-identity-contract.ts";

const IDENTITY_MAX_OUTPUT_BYTES = 16 * 1024;
const SHA1_LENGTH = 40;
const SHA256_LENGTH = 64;
/** 解析后续 Git Review 请求共用的仓库与对象身份。 */
export class GitReviewIdentityResolver {
  readonly #execGitRaw: ExecGitRaw;
  readonly #realpath: (path: string) => Promise<string>;

  constructor(options: CreateGitReviewIdentityResolverOptions = {}) {
    this.#execGitRaw = options.execGitRaw ?? execGitRaw;
    this.#realpath = options.realpath ?? fsRealpath;
  }

  async resolveRepository(
    cwd: string,
    options: GitReviewIdentityExecutionOptions = {}
  ): Promise<GitReviewRepositoryIdentity> {
    assertGitReviewIdentityExecutionOptions(options);
    const base = await this.resolveRepositoryBase(cwd, options);
    const siblingController = new AbortController();
    const parentSignal =
      options.signal === options.budget?.signal ? undefined : options.signal;
    const removeParentAbort = forwardGitReviewIdentityAbort(
      parentSignal,
      siblingController
    );
    let firstError: unknown;
    let hasFirstError = false;
    const cancelSiblingOnFailure = async <T>(
      promise: Promise<T>
    ): Promise<T> => {
      try {
        return await promise;
      } catch (error) {
        if (!hasFirstError) {
          firstError = error;
          hasFirstError = true;
        }
        siblingController.abort("identity-sibling-failed");
        throw error;
      }
    };
    try {
      const [headResult, emptyTreeResult] = await Promise.allSettled([
        cancelSiblingOnFailure(
          this.#resolveHead(base.canonicalRoot, base.oidLength, {
            ...options,
            signal: siblingController.signal,
          })
        ),
        cancelSiblingOnFailure(
          this.#resolveEmptyTree(base.canonicalRoot, base.oidLength, {
            ...options,
            signal: siblingController.signal,
          })
        ),
      ]);
      if (hasFirstError) {
        throw firstError;
      }
      if (headResult.status !== "fulfilled") {
        throw headResult.reason;
      }
      if (emptyTreeResult.status !== "fulfilled") {
        throw emptyTreeResult.reason;
      }
      return Object.freeze({
        ...base,
        emptyTreeOid: emptyTreeResult.value,
        headOid: headResult.value,
      });
    } finally {
      removeParentAbort();
    }
  }

  async resolveRepositoryBase(
    cwd: string,
    options: GitReviewIdentityExecutionOptions = {}
  ): Promise<GitReviewRepositoryBaseIdentity> {
    assertGitReviewIdentityExecutionOptions(options);
    let reportedRoot: string;
    try {
      reportedRoot = await this.#collectLine(
        ["rev-parse", "--path-format=absolute", "--show-toplevel"],
        cwd,
        options
      );
    } catch (error) {
      if (error instanceof GitExecRawError && error.causeKind === "exit") {
        throw new GitReviewIdentityError(
          "notRepository",
          "路径不属于可解析的 Git 仓库",
          { cause: error }
        );
      }
      throw error;
    }
    const canonicalRoot = await raceGitReviewIdentityBoundary(
      () => this.#realpath(reportedRoot),
      options
    );
    const objectFormat = await this.#resolveObjectFormat(
      canonicalRoot,
      options
    );
    return Object.freeze({
      canonicalRoot,
      objectFormat,
      oidLength: objectFormat === "sha1" ? SHA1_LENGTH : SHA256_LENGTH,
    });
  }

  async resolveCommit(
    cwd: string,
    revision: string,
    options: GitReviewIdentityExecutionOptions = {}
  ): Promise<GitReviewCommitIdentity> {
    assertGitReviewIdentityExecutionOptions(options);
    const repository = await this.resolveRepositoryBase(cwd, options);
    return this.resolveCommitInRepository(repository, revision, options);
  }

  async resolveCommitInRepository(
    repository: GitReviewRepositoryBaseIdentity,
    revision: string,
    options: GitReviewIdentityExecutionOptions = {}
  ): Promise<GitReviewCommitIdentity> {
    assertGitReviewIdentityExecutionOptions(options);
    let oid: string;
    try {
      oid = await this.#collectLine(
        [
          "rev-parse",
          "--verify",
          "--quiet",
          "--end-of-options",
          `${revision}^{commit}`,
        ],
        repository.canonicalRoot,
        options
      );
    } catch (error) {
      if (
        error instanceof GitExecRawError &&
        error.causeKind === "exit" &&
        error.exitCode === 1
      ) {
        throw new GitReviewIdentityError(
          "invalidReference",
          "目标提交不存在或不是 commit",
          { cause: error }
        );
      }
      throw error;
    }
    assertOid(oid, repository.oidLength, "commit");
    const record = await this.#collectLine(
      ["rev-list", "--parents", "--max-count=1", oid, "--"],
      repository.canonicalRoot,
      options
    );
    const [resolvedOid, ...parentOids] = record.split(" ");
    if (resolvedOid !== oid) {
      throw new GitReviewIdentityError(
        "invalidOutput",
        "git rev-list 返回了不一致的 commit OID"
      );
    }
    for (const parentOid of parentOids) {
      assertOid(parentOid, repository.oidLength, "parent commit");
    }
    return Object.freeze({
      firstParentOid: parentOids[0] ?? null,
      oid,
      parentOids: Object.freeze(parentOids),
    });
  }

  async resolveBranchInRepository(
    repository: GitReviewRepositoryBaseIdentity,
    targetRef: string,
    headOid: string | null,
    options: GitReviewIdentityExecutionOptions = {}
  ): Promise<GitReviewBranchIdentity> {
    assertGitReviewIdentityExecutionOptions(options);
    if (headOid === null) {
      throw new GitReviewIdentityError(
        "unbornHead",
        "unborn HEAD 无法进行分支对比"
      );
    }
    assertOid(headOid, repository.oidLength, "HEAD");
    let record: string;
    try {
      record = await this.#collectLine(
        [
          "for-each-ref",
          "--count=2",
          "--format=%(refname)%09%(objectname)%09%(objecttype)",
          "--",
          targetRef,
        ],
        repository.canonicalRoot,
        options
      );
    } catch (error) {
      if (
        error instanceof GitReviewIdentityError &&
        error.kind === "invalidOutput"
      ) {
        throw new GitReviewIdentityError(
          "invalidReference",
          "目标分支不存在或返回了非法身份",
          { cause: error }
        );
      }
      throw error;
    }
    const fields = record.split("\t");
    if (
      fields.length !== 3 ||
      fields[0] !== targetRef ||
      fields[2] !== "commit"
    ) {
      throw new GitReviewIdentityError(
        "invalidReference",
        "目标分支必须精确指向一个 commit"
      );
    }
    const targetOid = fields[1] ?? "";
    assertOid(targetOid, repository.oidLength, "target branch");
    let mergeBaseOid: string;
    try {
      mergeBaseOid = await this.#collectLine(
        ["merge-base", "--", headOid, targetOid],
        repository.canonicalRoot,
        options
      );
    } catch (error) {
      if (
        error instanceof GitExecRawError &&
        error.causeKind === "exit" &&
        error.exitCode === 1
      ) {
        throw new GitReviewIdentityError(
          "noMergeBase",
          "目标分支与请求开始时的 HEAD 没有共同基点",
          { cause: error }
        );
      }
      throw error;
    }
    assertOid(mergeBaseOid, repository.oidLength, "merge base");
    return Object.freeze({
      headOid,
      mergeBaseOid,
      targetOid,
      targetRef,
    });
  }

  async #collectLine(
    args: readonly string[],
    cwd: string,
    options: GitReviewIdentityExecutionOptions,
    stdin?: Buffer
  ): Promise<string> {
    const result = await this.#execGitRaw(args, {
      cwd,
      maxOutputBytes: IDENTITY_MAX_OUTPUT_BYTES,
      mode: "collect",
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      ...(options.deadlineAtMs === undefined
        ? {}
        : { deadlineAtMs: options.deadlineAtMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(stdin === undefined ? {} : { stdin }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
    if (result.kind !== "collected") {
      throw new GitReviewIdentityError(
        "invalidOutput",
        "identity Git 命令未返回 collect 结果"
      );
    }
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
    } catch (error) {
      throw new GitReviewIdentityError(
        "invalidOutput",
        "identity Git 命令返回了非法 UTF-8",
        { cause: error }
      );
    }
    let line = decoded;
    if (decoded.endsWith("\r\n")) {
      line = decoded.slice(0, -2);
    } else if (decoded.endsWith("\n")) {
      line = decoded.slice(0, -1);
    }
    if (
      line.length === 0 ||
      line.includes("\0") ||
      line.includes("\n") ||
      line.includes("\r")
    ) {
      throw new GitReviewIdentityError(
        "invalidOutput",
        "identity Git 命令返回了空或非法输出"
      );
    }
    return line;
  }

  async #resolveEmptyTree(
    root: string,
    oidLength: number,
    options: GitReviewIdentityExecutionOptions
  ): Promise<string> {
    const oid = await this.#collectLine(
      ["hash-object", "-t", "tree", "--stdin"],
      root,
      options,
      Buffer.alloc(0)
    );
    assertOid(oid, oidLength, "empty tree");
    return oid;
  }

  async #resolveHead(
    root: string,
    oidLength: number,
    options: GitReviewIdentityExecutionOptions
  ): Promise<string | null> {
    try {
      const oid = await this.#collectLine(
        ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        root,
        options
      );
      assertOid(oid, oidLength, "HEAD");
      return oid;
    } catch (error) {
      if (
        error instanceof GitExecRawError &&
        error.causeKind === "exit" &&
        error.exitCode === 1
      ) {
        return null;
      }
      throw error;
    }
  }

  async #resolveObjectFormat(
    root: string,
    options: GitReviewIdentityExecutionOptions
  ): Promise<GitReviewObjectFormat> {
    const format = await this.#collectLine(
      ["rev-parse", "--show-object-format"],
      root,
      options
    );
    if (format === "sha1" || format === "sha256") {
      return format;
    }
    throw new GitReviewIdentityError(
      "unsupportedObjectFormat",
      `不支持的 Git 对象格式: ${format}`
    );
  }
}

function assertOid(value: string, length: number, label: string): void {
  if (value.length !== length || !/^[0-9a-f]+$/u.test(value)) {
    throw new GitReviewIdentityError(
      "invalidOutput",
      `${label} OID 与仓库对象格式不匹配`
    );
  }
}
