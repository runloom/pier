import { TextDecoder } from "node:util";
import { decodeFileDocument } from "../../files/document-codec.ts";
import { type ExecGitRaw, GitExecRawError } from "../exec.ts";
import {
  type BaselineEnvironment,
  type BaselineIdentity,
  type BaselineUnavailable,
  collectBaselineMetadata,
  unavailable,
} from "./identity.ts";

export interface BaselineContents {
  contents: string;
  existsAtHead: boolean;
}
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ENTRY =
  /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(-|\d+)\t/u;

export async function readBaselineBlob(
  exec: ExecGitRaw,
  identity: BaselineIdentity,
  env: BaselineEnvironment
): Promise<BaselineContents | BaselineUnavailable> {
  const { gitRoot, headOid, basePath } = identity;
  if (headOid === null) return { contents: "", existsAtHead: false };
  // A successful tree lookup proves absence; a failed object lookup never does.
  const output = await collectBaselineMetadata(
    exec,
    [
      "--literal-pathspecs",
      "ls-tree",
      "--full-tree",
      "-z",
      "-l",
      headOid,
      "--",
      basePath,
    ],
    gitRoot,
    env,
    64 * 1024
  );
  if (output === "") {
    // An uninitialized submodule has no child entries in the enclosing tree.
    // Its gitlink cannot prove that a requested file is new in the owning repo.
    const parts = basePath.split("/");
    for (let index = 1; index < parts.length; index++) {
      const ancestor = await collectBaselineMetadata(
        exec,
        [
          "--literal-pathspecs",
          "ls-tree",
          "--full-tree",
          "-z",
          "-l",
          headOid,
          "--",
          parts.slice(0, index).join("/"),
        ],
        gitRoot,
        env,
        64 * 1024
      );
      if (ancestor === "") break;
      if (ancestor.startsWith("160000 commit "))
        return unavailable("unsupported-file");
    }
    return { contents: "", existsAtHead: false };
  }
  const match = ENTRY.exec(output);
  if (!match || output.slice(match[0].length) !== `${basePath}\0`) {
    throw new Error("Invalid Git baseline tree entry");
  }
  if (match[2] !== "blob" || (match[1] !== "100644" && match[1] !== "100755")) {
    return unavailable("unsupported-file");
  }
  const size = Number(match[4]);
  const oid = match[3];
  if (!Number.isSafeInteger(size) || size < 0 || oid === undefined)
    throw new Error("Invalid Git baseline blob size");
  if (size > MAX_FILE_BYTES) return unavailable("too-large");
  return readTextBlob(exec, gitRoot, oid, size, env);
}

async function readTextBlob(
  exec: ExecGitRaw,
  gitRoot: string,
  oid: string,
  size: number,
  env: BaselineEnvironment
): Promise<BaselineContents | BaselineUnavailable> {
  const chunks: Buffer[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let rejected: BaselineUnavailable | undefined;
  let bytes = 0;
  try {
    await exec(["--no-replace-objects", "cat-file", "blob", oid], {
      cwd: gitRoot,
      env,
      mode: "chunks",
      maxOutputBytes: size + 64 * 1024,
      onStdoutChunk(chunk) {
        // Validate while streaming, before retaining content. No textconv,
        // filters or index access can change this immutable blob's bytes.
        if (
          bytes === 0 &&
          ((chunk[0] === 0xff && chunk[1] === 0xfe) ||
            (chunk[0] === 0xfe && chunk[1] === 0xff))
        ) {
          rejected = unavailable("unsupported-encoding");
        } else if (chunk.includes(0)) {
          rejected = unavailable("binary");
        } else {
          try {
            decoder.decode(chunk, { stream: true });
          } catch {
            rejected = unavailable("unsupported-encoding");
          }
        }
        bytes += chunk.length;
        if (bytes > MAX_FILE_BYTES || bytes > size)
          throw new Error("Git baseline blob exceeded its declared size");
        if (rejected) throw new Error(rejected.reason);
        chunks.push(Buffer.from(chunk));
      },
    });
  } catch (error) {
    if (
      rejected &&
      error instanceof GitExecRawError &&
      error.causeKind === "record-consumer"
    )
      return rejected;
    throw error;
  }
  if (bytes !== size) throw new Error("Incomplete Git baseline blob");
  try {
    decoder.decode();
  } catch {
    return unavailable("unsupported-encoding");
  }
  const decoded = decodeFileDocument(Buffer.concat(chunks, bytes));
  if (decoded.kind !== "text") return unavailable(decoded.kind);
  if (decoded.format.encoding !== "utf8")
    return unavailable("unsupported-encoding");
  return { contents: decoded.contents, existsAtHead: true };
}
