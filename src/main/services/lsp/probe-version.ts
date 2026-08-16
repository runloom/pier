import { spawn } from "node:child_process";
import { launchSpecForResolvedBinary } from "./resolve-command.ts";

/** Bound `--version` wait; detached spawn of PATH wrappers can exceed a few hundred ms. */
export const LSP_VERSION_PROBE_TIMEOUT_MS = 1500;
const VERSION_MAX_CHARS = 64;
const VERSION_MAX_BYTES = 4096;

/**
 * Basenames whose `--version` is a cheap CLI (not a language-server wrapper).
 * Unknown / wrapper names are skipped so Settings never boots jdtls/metals/etc.
 */
const VERSION_PROBE_BASENAMES = new Set([
  "bash-language-server",
  "basedpyright-langserver",
  "clangd",
  "csharp-ls",
  "dart",
  "docker-langserver",
  "gopls",
  "intelephense",
  "kotlin-language-server",
  "lua-language-server",
  "marksman",
  "omnisharp",
  "pyright-langserver",
  "ruby-lsp",
  "rust-analyzer",
  "solargraph",
  "sourcekit-lsp",
  "sql-language-server",
  "svelte-language-server",
  "svelteserver",
  "taplo",
  "vscode-css-language-server",
  "vscode-html-language-server",
  "vscode-json-language-server",
  "vue-language-server",
  "yaml-language-server",
  "zls",
]);

export function catalogBinaryBasename(resolvedPath: string): string {
  const leaf = resolvedPath.split(/[\\/]/u).at(-1)?.trim() || resolvedPath;
  return leaf.replace(/\.(?:exe|cmd|bat)$/iu, "").toLowerCase();
}

export function shouldProbeBinaryVersion(resolvedPath: string): boolean {
  return VERSION_PROBE_BASENAMES.has(catalogBinaryBasename(resolvedPath));
}

/**
 * First non-empty line of `--version` stdout, collapsed and capped.
 * Language servers are not a version API — this is display-only.
 */
export function parseVersionLine(output: string): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) {
    return;
  }
  const collapsed = line.replace(/\s+/g, " ");
  if (collapsed.length <= VERSION_MAX_CHARS) {
    return collapsed;
  }
  return collapsed.slice(0, VERSION_MAX_CHARS).trimEnd();
}

function killProbeTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (process.platform !== "win32" && typeof pid === "number" && pid > 0) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // Fall through to the direct child.
    }
  }
  if (process.platform === "win32" && typeof pid === "number" && pid > 0) {
    try {
      const killer = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref?.();
    } catch {
      // Fall through to the direct child.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Already gone, or the signal could not be delivered.
  }
}

function releaseChild(child: ReturnType<typeof spawn>): void {
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref?.();
}

/**
 * Best-effort `--version` for a PATH-resolved language-server binary.
 * Stdin is ignored so stdio servers cannot block waiting for LSP.
 * Callers must consult `shouldProbeBinaryVersion` first.
 */
export function probeResolvedBinaryVersion(
  resolvedPath: string
): Promise<string | undefined> {
  const launch = launchSpecForResolvedBinary(resolvedPath, ["--version"]);
  if (!launch) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    let settled = false;
    const stdoutChunks: Buffer[] = [];
    let byteLength = 0;
    const finish = (value?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(launch.command, launch.args, {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      finish();
      return;
    }

    const timer = setTimeout(() => {
      try {
        killProbeTree(child);
      } finally {
        releaseChild(child);
        finish();
      }
    }, LSP_VERSION_PROBE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled || byteLength >= VERSION_MAX_BYTES) {
        return;
      }
      const room = VERSION_MAX_BYTES - byteLength;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      stdoutChunks.push(slice);
      byteLength += slice.length;
    });
    child.stderr?.resume();
    child.on("error", () => {
      clearTimeout(timer);
      releaseChild(child);
      finish();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      releaseChild(child);
      if (code !== 0) {
        finish();
        return;
      }
      finish(parseVersionLine(Buffer.concat(stdoutChunks).toString("utf8")));
    });
  });
}
