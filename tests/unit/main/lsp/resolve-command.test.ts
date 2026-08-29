import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  binaryPathFromLaunchSpec,
  resolveWorkspaceRelativeBinary,
} from "../../../../src/main/services/lsp/resolve-command.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("binaryPathFromLaunchSpec", () => {
  it("returns an absolute unix command as-is", () => {
    expect(
      binaryPathFromLaunchSpec({
        args: ["--stdio"],
        command: "/opt/homebrew/bin/gopls",
      })
    ).toBe("/opt/homebrew/bin/gopls");
  });

  it("extracts the quoted .cmd script from a cmd.exe launch", () => {
    expect(
      binaryPathFromLaunchSpec({
        args: ["/d", "/s", "/c", `"C:\\tools\\gopls.cmd" --version`],
        command: "C:\\Windows\\System32\\cmd.exe",
      })
    ).toBe("C:\\tools\\gopls.cmd");
  });

  it("does not treat cmd.exe itself as the language-server path", () => {
    expect(
      binaryPathFromLaunchSpec({
        args: ["/d", "/s", "/c"],
        command: "cmd.exe",
      })
    ).toBeNull();
  });
});

describe("resolveWorkspaceRelativeBinary windows suffixes", () => {
  async function withDartBin(
    write: (bin: string) => Promise<void>
  ): Promise<{ bin: string; root: string }> {
    const root = await mkdtemp(join(tmpdir(), "pier-win-dart-"));
    const bin = join(root, ".fvm", "flutter_sdk", "bin");
    await mkdir(bin, { recursive: true });
    await write(bin);
    return { bin, root };
  }

  it("prefers dart.bat over an extensionless dart script on win32", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const { bin, root } = await withDartBin(async (dir) => {
      await writeFile(join(dir, "dart"), "#!/bin/sh\n");
      await writeFile(join(dir, "dart.bat"), "@echo off\n");
    });
    try {
      expect(
        resolveWorkspaceRelativeBinary(root, ".fvm/flutter_sdk/bin/dart")
      ).toBe(join(bin, "dart.bat"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("falls back to extensionless dart when no win suffix exists", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const { bin, root } = await withDartBin(async (dir) => {
      await writeFile(join(dir, "dart"), "#!/bin/sh\n");
    });
    try {
      expect(
        resolveWorkspaceRelativeBinary(root, ".fvm/flutter_sdk/bin/dart")
      ).toBe(join(bin, "dart"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps the extensionless dart on posix when dart.bat also exists", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const { bin, root } = await withDartBin(async (dir) => {
      await writeFile(join(dir, "dart"), "#!/bin/sh\n");
      await writeFile(join(dir, "dart.bat"), "@echo off\n");
    });
    try {
      expect(
        resolveWorkspaceRelativeBinary(root, ".fvm/flutter_sdk/bin/dart")
      ).toBe(join(bin, "dart"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
