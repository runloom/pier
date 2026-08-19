import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { GitBlobFilePreviewTicketLocator } from "@shared/contracts/file/preview-ticket.ts";
import type { FilePreviewImageMime } from "@shared/contracts/file.ts";
import {
  execGitRaw as defaultExecGitRaw,
  type ExecGitRaw,
} from "../services/git/exec.ts";
import type { GitExecExecutionBudget } from "../services/git/exec-raw-contract.ts";
import { readPreviewImageDimensions } from "./image-metadata.ts";
import { MAX_IMAGE_PREVIEW_FILE_BYTES } from "./image-preview-file.ts";
import { classifyPreviewImageSignature } from "./image-signature.ts";

const GIT_BLOB_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BATCH_HEADER_OVERHEAD = 256;

export type GitBlobImagePreviewFailure =
  | "not-found"
  | "too-large"
  | "unsupported";

export type GitBlobImagePreviewResult =
  | {
      byteSize: number;
      bytes: Buffer;
      height: number | null;
      mime: FilePreviewImageMime;
      ok: true;
      revision: string;
      width: number | null;
    }
  | { ok: false; reason: GitBlobImagePreviewFailure };

export async function resolveGitBlobImagePreview(input: {
  readonly budget?: GitExecExecutionBudget;
  readonly execGitRaw?: ExecGitRaw;
  readonly gitRoot: string;
  readonly oid: string;
  readonly signal?: AbortSignal;
}): Promise<GitBlobImagePreviewResult> {
  if (!(isAbsolute(input.gitRoot) && GIT_BLOB_OID_PATTERN.test(input.oid))) {
    return { ok: false, reason: "unsupported" };
  }
  let cwd: string;
  try {
    cwd = await realpath(input.gitRoot);
    const info = await stat(cwd);
    if (!info.isDirectory()) {
      return { ok: false, reason: "unsupported" };
    }
  } catch {
    return { ok: false, reason: "not-found" };
  }
  const execGitRaw = input.execGitRaw ?? defaultExecGitRaw;
  const inside = await gitText(
    execGitRaw,
    ["rev-parse", "--is-inside-work-tree"],
    cwd,
    input
  );
  if (inside !== "true") {
    return { ok: false, reason: "unsupported" };
  }
  const toplevel = await gitText(
    execGitRaw,
    ["rev-parse", "--path-format=absolute", "--show-toplevel"],
    cwd,
    input
  );
  if (toplevel === null) {
    return { ok: false, reason: "unsupported" };
  }
  try {
    if ((await realpath(toplevel)) !== cwd) {
      return { ok: false, reason: "unsupported" };
    }
  } catch {
    return { ok: false, reason: "unsupported" };
  }
  const check = await gitCollect(
    execGitRaw,
    ["cat-file", "--batch-check"],
    cwd,
    Buffer.from(`${input.oid}\n`, "ascii"),
    4096,
    input
  );
  if (!check) {
    return { ok: false, reason: "not-found" };
  }
  const checked = parseBatchCheck(check, input.oid);
  if (checked === null) {
    return { ok: false, reason: "not-found" };
  }
  if (checked.kind === "missing" || checked.type !== "blob") {
    return { ok: false, reason: "unsupported" };
  }
  if (checked.size > MAX_IMAGE_PREVIEW_FILE_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  const payload = await gitCollect(
    execGitRaw,
    ["cat-file", "--batch"],
    cwd,
    Buffer.from(`${input.oid}\n`, "ascii"),
    checked.size + BATCH_HEADER_OVERHEAD,
    input
  );
  if (!payload) {
    return { ok: false, reason: "not-found" };
  }
  const bytes = parseBatchPayload(payload, input.oid, checked.size);
  if (!bytes) {
    return { ok: false, reason: "not-found" };
  }
  const mime = classifyPreviewImageSignature(bytes);
  if (!mime) {
    return { ok: false, reason: "unsupported" };
  }
  const dimensions = readPreviewImageDimensions(bytes);
  return {
    byteSize: bytes.length,
    bytes,
    height: dimensions?.height ?? null,
    mime,
    ok: true,
    revision: input.oid,
    width: dimensions?.width ?? null,
  };
}

export function gitBlobLocatorFromPreview(input: {
  readonly gitRoot: string;
  readonly mime: FilePreviewImageMime;
  readonly oid: string;
}): GitBlobFilePreviewTicketLocator {
  return {
    gitRoot: input.gitRoot,
    mime: input.mime,
    oid: input.oid,
    revision: input.oid,
  };
}

function parseBatchCheck(
  stdout: Buffer,
  oid: string
): { kind: "missing" } | { kind: "ok"; size: number; type: string } | null {
  const line = stdout.toString("ascii").replace(/\r?\n$/u, "");
  if (line === `${oid} missing`) {
    return { kind: "missing" };
  }
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) ([a-z]+) (\d+)$/u.exec(line);
  if (!match || match[1] !== oid) {
    return null;
  }
  const size = Number(match[3]);
  if (!Number.isSafeInteger(size) || size < 0) {
    return null;
  }
  return { kind: "ok", size, type: match[2] ?? "" };
}

function parseBatchPayload(
  stdout: Buffer,
  oid: string,
  size: number
): Buffer | null {
  const headerEnd = stdout.indexOf(10);
  if (headerEnd < 0) {
    return null;
  }
  const header = stdout.subarray(0, headerEnd).toString("ascii");
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (\d+)$/u.exec(header);
  if (!match || match[1] !== oid || Number(match[2]) !== size) {
    return null;
  }
  const start = headerEnd + 1;
  const end = start + size;
  if (stdout.length < end) {
    return null;
  }
  return Buffer.from(stdout.subarray(start, end));
}

async function gitText(
  execGitRaw: ExecGitRaw,
  args: readonly string[],
  cwd: string,
  options: {
    readonly budget?: GitExecExecutionBudget;
    readonly signal?: AbortSignal;
  }
): Promise<string | null> {
  const stdout = await gitCollect(execGitRaw, args, cwd, undefined, 4096, {
    ...options,
  });
  if (!stdout) {
    return null;
  }
  return stdout.toString("utf8").trim();
}

async function gitCollect(
  execGitRaw: ExecGitRaw,
  args: readonly string[],
  cwd: string,
  stdin: Buffer | undefined,
  maxOutputBytes: number,
  options: {
    readonly budget?: GitExecExecutionBudget;
    readonly signal?: AbortSignal;
  }
): Promise<Buffer | null> {
  try {
    const result = await execGitRaw(args, {
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      cwd,
      maxOutputBytes,
      mode: "collect",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(stdin === undefined ? {} : { stdin }),
    });
    if (result.kind !== "collected" || result.stdout.length === 0) {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}
