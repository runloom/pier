/**
 * Content search executor — spawns application-owned ripgrep and streams
 * structured hits. Injectable for unit tests.
 *
 * Design: docs/superpowers/specs/2026-07-27-files-content-search-design.md §5
 */

import { type ChildProcess, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import {
  FILE_CONTENT_QUERY_MAX_FILE_SIZE_BYTES_DEFAULT,
  FILE_CONTENT_QUERY_RESULTS_DEFAULT,
  type FileContentQueryItem,
  type FileContentQueryStart,
} from "@shared/contracts/file/query.ts";
import { ContentSearchError } from "./content-search-error.ts";
import { parseRgMatchLine } from "./content-search-parse.ts";
import { resolveSearchRoot } from "./content-search-scope.ts";
import {
  resolveSearchRuntime,
  type SearchRuntimeResolution,
} from "./search-runtime.ts";

export { ContentSearchError } from "./content-search-error.ts";
export {
  parseRgMatchLine,
  resolveContentExcludePatterns,
  utf8ByteOffsetToStringIndex,
} from "./content-search-parse.ts";

export const FILE_CONTENT_QUERY_BATCH_SIZE = 50;
/** Force-kill grace after SIGTERM on cancel/limit (ms). */
export const FILE_CONTENT_SEARCH_KILL_GRACE_MS = 2000;

export type ContentSearchEmitBatch = (
  items: readonly FileContentQueryItem[]
) => void;

export interface ContentSearchRunResult {
  readonly scanned: number;
  readonly truncated: boolean;
}

export interface ContentSearchRunInput {
  readonly defaultExcludePatterns: string;
  readonly onBatch: ContentSearchEmitBatch;
  readonly request: FileContentQueryStart;
  readonly signal: AbortSignal;
}

export type ContentSearchRunner = (
  input: ContentSearchRunInput
) => Promise<ContentSearchRunResult>;

export interface CreateRgContentSearchRunnerOptions {
  readonly batchSize?: number;
  readonly resolveRuntime?: () => SearchRuntimeResolution;
  readonly spawnImpl?: typeof spawn;
}

export function createRgContentSearchRunner(
  options: CreateRgContentSearchRunnerOptions = {}
): ContentSearchRunner {
  const resolveRuntime =
    options.resolveRuntime ?? (() => resolveSearchRuntime());
  const spawnImpl = options.spawnImpl ?? spawn;
  const batchSize = options.batchSize ?? FILE_CONTENT_QUERY_BATCH_SIZE;

  return async (input) => {
    const { request, signal, onBatch } = input;
    if (signal.aborted) {
      return { scanned: 0, truncated: false };
    }

    if (request.query.length === 0) {
      return { scanned: 0, truncated: false };
    }

    const runtime = resolveRuntime();
    if (runtime.kind === "unavailable") {
      throw new ContentSearchError(
        "search-runtime-unavailable",
        `Content search runtime is not available (arch=${runtime.arch}; tried: ${runtime.tried.join(", ") || "none"})`
      );
    }

    const searchRoot = await resolveSearchRoot(
      request.root,
      request.options?.scopeDir
    );
    let projectRootReal: string;
    try {
      projectRootReal = await realpath(request.root);
    } catch (error) {
      throw new ContentSearchError(
        "content-search-failed",
        error instanceof Error ? error.message : String(error)
      );
    }
    const maxResults =
      request.options?.maxResults ?? FILE_CONTENT_QUERY_RESULTS_DEFAULT;
    const maxFileSizeBytes =
      request.options?.maxFileSizeBytes ??
      FILE_CONTENT_QUERY_MAX_FILE_SIZE_BYTES_DEFAULT;

    const args = buildRgArgs({
      request,
      searchRoot,
      maxFileSizeBytes,
      defaultExcludePatterns: input.defaultExcludePatterns,
    });

    return await new Promise<ContentSearchRunResult>(
      (resolvePromise, reject) => {
        let settled = false;
        let child: ChildProcess;
        try {
          child = spawnImpl(runtime.executablePath, args, {
            cwd: projectRootReal,
            env: {
              ...process.env,
              RIPGREP_CONFIG_PATH: "",
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (error) {
          reject(
            new ContentSearchError(
              "content-search-failed",
              error instanceof Error ? error.message : String(error)
            )
          );
          return;
        }

        const stdout = child.stdout;
        const stderr = child.stderr;
        if (!(stdout && stderr)) {
          reject(
            new ContentSearchError(
              "content-search-failed",
              "content search runtime did not provide stdio pipes"
            )
          );
          return;
        }

        let stdoutBuf = "";
        let stderrBuf = "";
        let emitted = 0;
        let truncated = false;
        let pending: FileContentQueryItem[] = [];
        let killTimer: ReturnType<typeof setTimeout> | null = null;

        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          if (killTimer !== null) {
            clearTimeout(killTimer);
            killTimer = null;
          }
          signal.removeEventListener("abort", onAbort);
          fn();
        };

        const flush = (): void => {
          if (pending.length === 0) return;
          const batch = pending;
          pending = [];
          onBatch(batch);
        };

        const requestKill = (): void => {
          if (child.killed || settled) return;
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore
          }
          if (killTimer === null) {
            killTimer = setTimeout(() => {
              try {
                if (!child.killed) child.kill("SIGKILL");
              } catch {
                // ignore
              }
            }, FILE_CONTENT_SEARCH_KILL_GRACE_MS);
          }
        };

        const pushItem = (item: FileContentQueryItem): void => {
          if (emitted >= maxResults) return;
          pending.push(item);
          emitted += 1;
          if (pending.length >= batchSize) flush();
          if (emitted >= maxResults) {
            truncated = true;
            flush();
            requestKill();
          }
        };

        const onAbort = (): void => {
          requestKill();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          requestKill();
        }

        stdout.setEncoding("utf8");
        stderr.setEncoding("utf8");

        stdout.on("data", (chunk: string) => {
          if (settled || truncated) return;
          stdoutBuf += chunk;
          if (stdoutBuf.length > 4 * 1024 * 1024) {
            settle(() => {
              reject(
                new ContentSearchError(
                  "content-search-failed",
                  "content search output exceeded buffer limit"
                )
              );
            });
            requestKill();
            return;
          }
          let nl = stdoutBuf.indexOf("\n");
          while (nl >= 0) {
            const line = stdoutBuf.slice(0, nl);
            stdoutBuf = stdoutBuf.slice(nl + 1);
            for (const item of parseRgMatchLine(line, projectRootReal)) {
              pushItem(item);
              if (truncated) break;
            }
            if (truncated) break;
            nl = stdoutBuf.indexOf("\n");
          }
        });

        stderr.on("data", (chunk: string) => {
          stderrBuf += chunk;
          if (stderrBuf.length > 16_384) {
            stderrBuf = stderrBuf.slice(-8192);
          }
        });

        child.on("error", (error) => {
          settle(() => {
            reject(
              new ContentSearchError(
                "content-search-failed",
                error.message || "failed to spawn content search runtime"
              )
            );
          });
        });

        child.on("close", (code, closeSignal) => {
          settle(() => {
            if (signal.aborted) {
              resolvePromise({ scanned: emitted, truncated: false });
              return;
            }
            if (!truncated && stdoutBuf.trim().length > 0) {
              for (const item of parseRgMatchLine(stdoutBuf, projectRootReal)) {
                pushItem(item);
                if (truncated) break;
              }
            }
            flush();

            if (code === 0 || code === 1 || truncated) {
              resolvePromise({ scanned: emitted, truncated });
              return;
            }
            if (closeSignal === "SIGTERM" || closeSignal === "SIGKILL") {
              resolvePromise({ scanned: emitted, truncated });
              return;
            }
            const detail = stderrBuf.trim() || `rg exited with code ${code}`;
            if (/regex parse error|exists but not|invalid/i.test(detail)) {
              reject(
                new ContentSearchError("invalid-regexp", detail.slice(0, 2048))
              );
              return;
            }
            reject(
              new ContentSearchError(
                "content-search-failed",
                detail.slice(0, 2048)
              )
            );
          });
        });
      }
    );
  };
}

function buildRgArgs(args: {
  readonly defaultExcludePatterns: string;
  readonly maxFileSizeBytes: number;
  readonly request: FileContentQueryStart;
  readonly searchRoot: string;
}): string[] {
  const { request, searchRoot, maxFileSizeBytes, defaultExcludePatterns } =
    args;
  const options = request.options;
  const out: string[] = [
    "--json",
    "--no-config",
    "--color=never",
    "--hidden",
    "--max-filesize",
    String(maxFileSizeBytes),
  ];

  if (!(options?.caseSensitive ?? false)) {
    out.push("-i");
  }
  if (options?.wholeWord) {
    out.push("-w");
  }
  if (!(options?.regexp ?? false)) {
    out.push("-F");
  }
  out.push("-e", request.query);

  if (!(options?.applyGitIgnore ?? true)) {
    out.push("--no-ignore", "--no-ignore-vcs", "--no-ignore-parent");
  }

  if (options?.include) {
    for (const pattern of options.include
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)) {
      out.push("--glob", pattern);
    }
  }

  const applyExcludes = options?.applyExcludePatterns ?? true;
  if (applyExcludes) {
    const source =
      options?.excludePatterns === undefined
        ? defaultExcludePatterns
        : options.excludePatterns;
    for (const pattern of parseExcludeLines(source)) {
      out.push("--glob", `!${pattern}`);
    }
  }

  out.push("--", searchRoot);
  return out;
}

function parseExcludeLines(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
