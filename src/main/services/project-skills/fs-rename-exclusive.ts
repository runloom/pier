import { execFile } from "node:child_process";
import { lstat, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** macOS renamex_np flag: fail if the destination already exists. */
const DARWIN_RENAME_EXCL = 0x00_00_00_04;

let cachedDarwinRenameExclusiveHelper: Promise<string> | undefined;

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function eexistError(source: string, target: string): NodeJS.ErrnoException {
  const error = new Error(
    `EEXIST: file already exists, rename '${source}' -> '${target}'`
  ) as NodeJS.ErrnoException;
  error.code = "EEXIST";
  return error;
}

function stderrText(error: unknown): string {
  if (!error || typeof error !== "object" || !("stderr" in error)) {
    return "";
  }
  const stderr = error.stderr;
  if (typeof stderr === "string") {
    return stderr.trim();
  }
  if (Buffer.isBuffer(stderr)) {
    return stderr.toString("utf8").trim();
  }
  return "";
}

async function ensureDarwinRenameExclusiveHelper(): Promise<string> {
  if (!cachedDarwinRenameExclusiveHelper) {
    cachedDarwinRenameExclusiveHelper = (async () => {
      const helperDir = tmpdir();
      const base = `pier-renamex-excl-${process.pid}`;
      const cPath = resolve(helperDir, `${base}.c`);
      const binPath = resolve(helperDir, base);
      const source = [
        "#include <errno.h>",
        "#include <stdio.h>",
        "#include <unistd.h>",
        "#ifndef RENAME_EXCL",
        `#define RENAME_EXCL ${DARWIN_RENAME_EXCL}`,
        "#endif",
        "int main(int argc, char **argv) {",
        "  if (argc != 3) return 2;",
        "  if (renamex_np(argv[1], argv[2], RENAME_EXCL) == 0) return 0;",
        '  fprintf(stderr, "%d\\n", errno);',
        "  return 1;",
        "}",
        "",
      ].join("\n");
      await writeFile(cPath, source, "utf8");
      try {
        await execFileAsync("cc", ["-O2", "-o", binPath, cPath], {
          timeout: 30_000,
        });
      } finally {
        await rm(cPath, { force: true }).catch(() => undefined);
      }
      return binPath;
    })().catch((error: unknown) => {
      cachedDarwinRenameExclusiveHelper = undefined;
      throw error;
    });
  }
  return await cachedDarwinRenameExclusiveHelper;
}

/**
 * No-clobber directory-entry publish. On Darwin, renamex_np(RENAME_EXCL)
 * preserves the source object identity. This is not a claim of strong CAS
 * against uncooperative external writers.
 */
export async function defaultRenameExclusive(
  source: string,
  target: string
): Promise<void> {
  if (process.platform === "darwin") {
    const helper = await ensureDarwinRenameExclusiveHelper();
    // One retry: under heavy parallel vitest load, spawn/renamex can transiently
    // fail without EEXIST (false negatives in project-skills suite).
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await execFileAsync(helper, [source, target], { timeout: 15_000 });
        return;
      } catch (error) {
        const errno = Number.parseInt(
          stderrText(error).split(/\s+/).at(0) ?? "",
          10
        );
        if (errno === 17) {
          throw eexistError(source, target);
        }
        lastError = error;
        if (attempt === 0) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
      }
    }
    throw lastError;
  }

  try {
    await lstat(target);
    throw eexistError(source, target);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
  await rename(source, target);
}
