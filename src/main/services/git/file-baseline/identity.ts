import { isUtf8 } from "node:buffer";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  type GitFileBaselineInput,
  type GitFileBaselineResult,
  gitFileBaselineInputSchema,
} from "../../../../shared/contracts/git/file-baseline.ts";
import { GIT_STATUS_ARGS } from "../change-summary.ts";
import { type ExecGitRaw, GitExecRawError } from "../exec.ts";
import { parseGitStatus } from "../parsers.ts";
import { parseGitSinglePathOutput } from "../path-output.ts";

export type BaselineIdentity = Pick<
  Extract<GitFileBaselineResult, { status: "ready" }>,
  "gitRoot" | "path" | "basePath" | "headOid"
>;
export type BaselineUnavailable = Extract<
  GitFileBaselineResult,
  { status: "unavailable" }
>;
export type BaselineEnvironment = Readonly<Record<string, string>>;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function unavailable(
  reason: BaselineUnavailable["reason"]
): BaselineUnavailable {
  return { status: "unavailable", reason };
}

async function collectBaselineBytes(
  exec: ExecGitRaw,
  args: readonly string[],
  cwd: string,
  env: BaselineEnvironment,
  maxOutputBytes = 16 * 1024
): Promise<Buffer> {
  // Cache identity refers to stored objects. Replacement refs must not alter
  // HEAD lookup, rename metadata or the tree/blob-size lookup behind that key.
  const result = await exec(["--no-replace-objects", ...args], {
    cwd,
    env,
    maxOutputBytes,
    mode: "collect",
  });
  if (result.kind !== "collected") {
    throw new Error("Invalid Git file baseline metadata");
  }
  return result.stdout;
}

export async function collectBaselineMetadata(
  exec: ExecGitRaw,
  args: readonly string[],
  cwd: string,
  env: BaselineEnvironment,
  maxOutputBytes = 16 * 1024
): Promise<string> {
  const bytes = await collectBaselineBytes(
    exec,
    args,
    cwd,
    env,
    maxOutputBytes
  );
  if (!isUtf8(bytes)) throw new Error("Invalid Git file baseline metadata");
  return bytes.toString("utf8");
}

function isQuietMissing(error: unknown): boolean {
  return (
    error instanceof GitExecRawError &&
    error.causeKind === "exit" &&
    error.exitCode === 1 &&
    error.signal === null &&
    error.stderrBytes === 0
  );
}

async function resolveHead(
  exec: ExecGitRaw,
  root: string,
  env: BaselineEnvironment
): Promise<string | null> {
  try {
    const oid = (
      await collectBaselineMetadata(
        exec,
        ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        root,
        env
      )
    ).trim();
    if (!OID.test(oid)) throw new Error("Invalid Git HEAD object id");
    return oid;
  } catch (error) {
    if (!isQuietMissing(error)) throw error;
    // rev-parse failure alone cannot prove an unborn HEAD: damaged refs and
    // missing objects also fail. Require a symbolic branch whose ref is absent.
    const ref = (
      await collectBaselineMetadata(
        exec,
        ["symbolic-ref", "--quiet", "HEAD"],
        root,
        env
      )
    ).trim();
    if (!ref.startsWith("refs/heads/")) throw error;
    try {
      await collectBaselineMetadata(
        exec,
        ["show-ref", "--verify", "--quiet", ref],
        root,
        env
      );
    } catch (refError) {
      if (isQuietMissing(refError)) return null;
      throw refError;
    }
    throw error;
  }
}

function containedPath(root: string, target: string): string {
  const path = relative(root, target);
  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error("File baseline path must be inside root");
  }
  return path.split(sep).join("/");
}

function isMetadataPath(path: string): boolean {
  return path.split("/").some((part) => part.toLowerCase() === ".git");
}

async function hasRepositoryMarker(root: string): Promise<boolean> {
  // Git emits the same discovery error for a broken HEAD and for no repository.
  // This diagnostic only prevents hiding damage; Git still owns all identity resolution.
  let directory = root;
  while (true) {
    try {
      await lstat(resolve(directory, ".git"));
      return true;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

async function fileDirectory(
  root: string,
  path: string
): Promise<string | null> {
  if (isMetadataPath(path)) return null;
  const parts = path.split("/");
  let target = root;
  let directory = root;
  for (const [index, part] of parts.entries()) {
    target = resolve(target, part);
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) return null;
      if (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
        return null;
      if (info.isDirectory()) directory = target;
    } catch (error) {
      // The working file (or a deleted parent) need not exist to read HEAD.
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return directory;
      throw error;
    }
  }
  return directory;
}

async function gitPath(
  exec: ExecGitRaw,
  root: string,
  path: string,
  headOid: string | null,
  env: BaselineEnvironment
): Promise<string> {
  let ignoreCase = false;
  try {
    ignoreCase =
      (
        await collectBaselineMetadata(
          exec,
          ["config", "--type=bool", "--get", "core.ignorecase"],
          root,
          env
        )
      ).trim() === "true";
  } catch (error) {
    if (!isQuietMissing(error)) throw error;
  }
  // Git applies its native precomposeunicode rules to argv on macOS. The index
  // owns current spelling, including case-only renames; HEAD supplies deletions.
  const depth = path.split("/").length;
  for (const tree of [null, ...(headOid ? [headOid] : [])]) {
    const output = await collectBaselineMetadata(
      exec,
      [
        "--no-literal-pathspecs",
        "ls-files",
        "--cached",
        "--full-name",
        "-z",
        ...(tree ? [`--with-tree=${tree}`] : []),
        "--",
        `:(top,literal${ignoreCase ? ",icase" : ""})${path}`,
      ],
      root,
      env,
      64 * 1024
    );
    // A literal directory pathspec also matches descendants; only accept the
    // requested depth, never resolve a missing directory to a child file.
    const paths = [
      ...new Set(
        output
          .split("\0")
          .filter((value) => value !== "" && value.split("/").length === depth)
      ),
    ];
    if (paths.length > 1) throw new Error("Ambiguous Git baseline file path");
    if (paths[0]) return paths[0];
  }
  return path;
}

export async function resolveBaselineIdentity(
  exec: ExecGitRaw,
  input: GitFileBaselineInput,
  env: BaselineEnvironment
): Promise<BaselineIdentity | BaselineUnavailable> {
  gitFileBaselineInputSchema.parse(input);
  if (!isAbsolute(input.root))
    throw new Error("File baseline root must be absolute");
  const inputPath = containedPath(
    resolve(input.root),
    resolve(input.root, input.path)
  );
  const root = await realpath(input.root);
  const directory = await fileDirectory(root, inputPath);
  if (directory === null) return unavailable("unsupported-file");
  let reportedRoot: string | null;
  try {
    reportedRoot = parseGitSinglePathOutput(
      await collectBaselineMetadata(
        exec,
        ["rev-parse", "--path-format=absolute", "--show-toplevel"],
        directory,
        env
      )
    );
  } catch (error) {
    if (
      error instanceof GitExecRawError &&
      error.causeKind === "exit" &&
      error.exitCode === 128 &&
      error.signal === null
    ) {
      const message = error.stderrTail.toString("utf8");
      if (
        /^fatal: not a git repository \(or any (?:of the parent directories|parent up to mount point)/u.test(
          message
        )
      ) {
        if (await hasRepositoryMarker(directory)) throw error;
        return unavailable("not-repository");
      }
      if (message.trim() === "fatal: this operation must be run in a work tree")
        return unavailable("unsupported-file");
    }
    throw error;
  }
  if (reportedRoot === null || !isAbsolute(reportedRoot))
    throw new Error("Invalid Git repository root");
  const gitRoot = await realpath(reportedRoot);
  const headOid = await resolveHead(exec, gitRoot, env);
  const path = await gitPath(
    exec,
    gitRoot,
    containedPath(gitRoot, resolve(root, inputPath)),
    headOid,
    env
  );
  // Latin-1 is a byte-preserving view for the existing porcelain parser. Decode
  // only the requested record; unrelated Git pathnames need not be UTF-8.
  const statusBytes = await collectBaselineBytes(
    exec,
    [...GIT_STATUS_ARGS, "--untracked-files=no"],
    gitRoot,
    env,
    4 * 1024 * 1024
  );
  const status = parseGitStatus(statusBytes.toString("latin1"));
  const file = status.files.find((candidate) =>
    Buffer.from(candidate.path, "latin1").equals(Buffer.from(path, "utf8"))
  );
  // Porcelain also supplies origPath for copies; only renames inherit HEAD's
  // original path. A copy is still a newly added path relative to HEAD.
  const original =
    file?.index === "R" || file?.worktree === "R" ? file.origPath : null;
  const originalBytes =
    original == null ? null : Buffer.from(original, "latin1");
  if (originalBytes && !isUtf8(originalBytes))
    throw new Error("Unsupported encoding in Git original file path");
  const basePath = originalBytes?.toString("utf8") ?? path;
  if (
    containedPath(gitRoot, resolve(gitRoot, basePath)) !== basePath ||
    isMetadataPath(basePath)
  ) {
    throw new Error("Invalid Git original file path");
  }
  return { gitRoot, path, basePath, headOid };
}
