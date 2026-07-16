import { realpath as fsRealpath } from "node:fs/promises";
import { gitReviewRootPathSchema } from "@shared/contracts/git-review.ts";
import { type ExecGitRaw, execGitRaw, GitExecRawError } from "../git-exec.ts";
import { parseGitSinglePathOutput } from "../git-path-output.ts";
import {
  assertGitReviewIdentityExecutionOptions,
  raceGitReviewIdentityBoundary,
} from "./git-review-identity-boundary.ts";
import {
  type CreateGitReviewIdentityResolverOptions,
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
    const headOid = await this.#resolveHead(
      base.canonicalRoot,
      base.oidLength,
      options
    );
    return Object.freeze({ ...base, headOid });
  }

  async resolveRepositoryBase(
    cwd: string,
    options: GitReviewIdentityExecutionOptions = {}
  ): Promise<GitReviewRepositoryBaseIdentity> {
    assertGitReviewIdentityExecutionOptions(options);
    let reportedRoot: string;
    try {
      reportedRoot = await this.#collectPath(
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

  async #collectOutput(
    args: readonly string[],
    cwd: string,
    options: GitReviewIdentityExecutionOptions
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
    return decoded;
  }

  async #collectLine(
    args: readonly string[],
    cwd: string,
    options: GitReviewIdentityExecutionOptions
  ): Promise<string> {
    const decoded = await this.#collectOutput(args, cwd, options);
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

  async #collectPath(
    args: readonly string[],
    cwd: string,
    options: GitReviewIdentityExecutionOptions
  ): Promise<string> {
    const path = parseGitSinglePathOutput(
      await this.#collectOutput(args, cwd, options)
    );
    const parsed = gitReviewRootPathSchema.safeParse(path);
    if (!parsed.success) {
      throw new GitReviewIdentityError(
        "invalidOutput",
        "identity Git 命令返回了非法绝对路径"
      );
    }
    return parsed.data;
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
