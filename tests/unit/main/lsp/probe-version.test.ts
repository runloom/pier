import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogBinaryBasename,
  LSP_VERSION_PROBE_TIMEOUT_MS,
  parseVersionLine,
  probeResolvedBinaryVersion,
  shouldProbeBinaryVersion,
} from "../../../../src/main/services/lsp/probe-version.ts";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pier-lsp-probe-"));
  tempDirs.push(dir);
  return dir;
}

function writeScript(fileName: string, source: string): string {
  const path = join(tempDir(), fileName);
  if (process.platform === "win32") {
    writeFileSync(path, `@echo off\r\n${source}\r\n`);
    return path;
  }
  writeFileSync(path, `#!/bin/sh\n${source}\n`);
  chmodSync(path, 0o755);
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("catalogBinaryBasename", () => {
  it("strips Windows executable suffixes", () => {
    expect(catalogBinaryBasename("C:\\tools\\gopls.exe")).toBe("gopls");
    expect(catalogBinaryBasename("/usr/bin/language_server.sh")).toBe(
      "language_server.sh"
    );
  });
});

describe("shouldProbeBinaryVersion", () => {
  it("allows known version CLIs and skips wrappers", () => {
    expect(shouldProbeBinaryVersion("/opt/homebrew/bin/gopls")).toBe(true);
    expect(shouldProbeBinaryVersion("C:\\tools\\rust-analyzer.exe")).toBe(true);
    expect(shouldProbeBinaryVersion("/usr/bin/jdtls")).toBe(false);
    expect(shouldProbeBinaryVersion("/usr/bin/metals")).toBe(false);
    expect(shouldProbeBinaryVersion("/usr/bin/xcrun")).toBe(false);
    expect(shouldProbeBinaryVersion("/usr/bin/R")).toBe(false);
    expect(shouldProbeBinaryVersion("/usr/local/bin/language_server.sh")).toBe(
      false
    );
    expect(shouldProbeBinaryVersion("/opt/custom-lsp")).toBe(false);
  });
});

describe("parseVersionLine", () => {
  it("returns the first non-empty collapsed line", () => {
    expect(parseVersionLine("\n  golang.org/x/tools/gopls v0.16.1  \n")).toBe(
      "golang.org/x/tools/gopls v0.16.1"
    );
  });

  it("caps long version banners", () => {
    const line = parseVersionLine(`rust-analyzer ${"ab".repeat(80)}`);
    expect(line).toBeDefined();
    expect(line?.length).toBeLessThanOrEqual(64);
  });

  it("returns undefined for empty output", () => {
    expect(parseVersionLine("  \n\n")).toBeUndefined();
  });
});

describe("probeResolvedBinaryVersion", () => {
  it("reads --version from the current Node binary", async () => {
    const version = await probeResolvedBinaryVersion(process.execPath);
    expect(version).toMatch(/^v?\d+/u);
  });

  it("ignores stderr and non-zero exits", async () => {
    const stderrOnly = writeScript(
      process.platform === "win32" ? "stderr.cmd" : "stderr",
      process.platform === "win32"
        ? "echo usage 1>&2\r\nexit 0"
        : "echo usage >&2\nexit 0"
    );
    const failed = writeScript(
      process.platform === "win32" ? "fail.cmd" : "fail",
      process.platform === "win32"
        ? "echo nope 1>&2\r\nexit 2"
        : "echo nope >&2\nexit 2"
    );
    const mixed = writeScript(
      process.platform === "win32" ? "mixed.cmd" : "mixed",
      process.platform === "win32"
        ? "echo warn 1>&2\r\necho gopls v1.2.3\r\nexit 0"
        : "echo warn >&2\necho gopls v1.2.3\nexit 0"
    );
    expect(await probeResolvedBinaryVersion(stderrOnly)).toBeUndefined();
    expect(await probeResolvedBinaryVersion(failed)).toBeUndefined();
    expect(await probeResolvedBinaryVersion(mixed)).toBe("gopls v1.2.3");
  });

  it("caps oversized stdout without hanging", async () => {
    const noisy = writeScript(
      process.platform === "win32" ? "noisy.cmd" : "noisy",
      process.platform === "win32"
        ? `echo v1.0 ${"x".repeat(8000)}\r\nexit 0`
        : `printf 'v1.0 ${"x".repeat(8000)}\\n'\nexit 0`
    );
    const started = Date.now();
    const version = await probeResolvedBinaryVersion(noisy);
    expect(version).toBeDefined();
    expect(version?.length).toBeLessThanOrEqual(64);
    expect(Date.now() - started).toBeLessThan(LSP_VERSION_PROBE_TIMEOUT_MS);
  });

  it("keeps the first line if the process hangs after printing", async () => {
    const printThenHang = writeScript(
      process.platform === "win32" ? "print-hang.cmd" : "print-hang",
      process.platform === "win32"
        ? "echo gopls v9.9.9\r\nping -n 30 127.0.0.1 >nul"
        : "echo gopls v9.9.9\nexec sleep 30"
    );
    const started = Date.now();
    const version = await probeResolvedBinaryVersion(printThenHang);
    expect(version).toBe("gopls v9.9.9");
    expect(Date.now() - started).toBeLessThan(
      LSP_VERSION_PROBE_TIMEOUT_MS + 2000
    );
  }, 8000);

  it("times out a hanging binary without returning a version", async () => {
    const hang = writeScript(
      process.platform === "win32" ? "hang.cmd" : "hang",
      process.platform === "win32"
        ? "ping -n 30 127.0.0.1 >nul"
        : "exec sleep 30"
    );
    const started = Date.now();
    const version = await probeResolvedBinaryVersion(hang);
    expect(version).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(
      LSP_VERSION_PROBE_TIMEOUT_MS + 2000
    );
  }, 8000);
});
