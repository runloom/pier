import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isKimiCodeInstallPath,
  isLegacyKimiCliInstall,
  isLegacyKimiCliPath,
} from "../../../../../src/main/services/agents/lifecycle/sources/kimi-legacy.ts";
import { shouldSkipEnumeratedBin } from "../../../../../src/main/services/agents/lifecycle/sources/path-enum.ts";

const UV_SHIM = `#!/usr/bin/env python3
from kimi_cli.__main__ import main
`;

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("isLegacyKimiCliPath", () => {
  it("detects uv tools layout and the kimi-cli basename", () => {
    expect(
      isLegacyKimiCliPath("/Users/x/.local/share/uv/tools/kimi-cli/bin/kimi")
    ).toBe(true);
    expect(isLegacyKimiCliPath("/Users/x/.local/bin/kimi-cli")).toBe(true);
    expect(isLegacyKimiCliPath("/Users/x/.kimi-code/bin/kimi")).toBe(false);
    expect(
      isLegacyKimiCliPath(
        "/opt/homebrew/lib/node_modules/@moonshot-ai/kimi-code/bin/kimi"
      )
    ).toBe(false);
  });
});

describe("isKimiCodeInstallPath", () => {
  it("matches official native and npm layouts", () => {
    expect(isKimiCodeInstallPath("/Users/x/.kimi-code/bin/kimi")).toBe(true);
    expect(
      isKimiCodeInstallPath(
        "/opt/homebrew/lib/node_modules/@moonshot-ai/kimi-code/bin/kimi"
      )
    ).toBe(true);
    expect(isKimiCodeInstallPath("/Users/x/.local/bin/kimi")).toBe(false);
  });
});

describe("isLegacyKimiCliInstall", () => {
  it("treats PATH kimi with no kimi-cli segment as leftover via sibling", () => {
    const bin = join(tempDir("pier-kimi-sibling-"), "bin");
    mkdirSync(bin);
    const kimi = join(bin, "kimi");
    writeFileSync(kimi, "#!/bin/sh\nexec true\n");
    chmodSync(kimi, 0o755);
    writeFileSync(join(bin, "kimi-cli"), UV_SHIM);
    chmodSync(join(bin, "kimi-cli"), 0o755);
    expect(isLegacyKimiCliPath(kimi)).toBe(false);
    expect(isLegacyKimiCliInstall(kimi)).toBe(true);
    expect(shouldSkipEnumeratedBin("kimi", kimi, kimi)).toBe(true);
  });

  it("treats a uv shebang copy as leftover without a sibling", () => {
    const bin = join(tempDir("pier-kimi-shebang-"), "bin");
    mkdirSync(bin);
    const kimi = join(bin, "kimi");
    writeFileSync(kimi, UV_SHIM);
    chmodSync(kimi, 0o755);
    expect(isLegacyKimiCliPath(kimi)).toBe(false);
    expect(isLegacyKimiCliInstall(kimi)).toBe(true);
  });

  it("follows a symlink into the uv kimi-cli layout", () => {
    const root = tempDir("pier-kimi-link-");
    const uvBin = join(root, "share", "uv", "tools", "kimi-cli", "bin");
    mkdirSync(uvBin, { recursive: true });
    const target = join(uvBin, "kimi");
    writeFileSync(target, UV_SHIM);
    chmodSync(target, 0o755);
    const pathBin = join(root, "bin");
    mkdirSync(pathBin);
    const kimi = join(pathBin, "kimi");
    symlinkSync(target, kimi);
    expect(isLegacyKimiCliPath(kimi)).toBe(false);
    expect(isLegacyKimiCliInstall(kimi)).toBe(true);
    expect(shouldSkipEnumeratedBin("kimi", kimi, target)).toBe(true);
  });

  it("does not skip native Kimi Code even when kimi-cli sits beside it", () => {
    const bin = join(tempDir("pier-kimi-native-"), ".kimi-code", "bin");
    mkdirSync(bin, { recursive: true });
    const kimi = join(bin, "kimi");
    writeFileSync(kimi, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    chmodSync(kimi, 0o755);
    writeFileSync(join(bin, "kimi-cli"), UV_SHIM);
    expect(isLegacyKimiCliInstall(kimi)).toBe(false);
    expect(shouldSkipEnumeratedBin("kimi", kimi, kimi)).toBe(false);
  });

  it("does not skip a native binary in a shared bin dir via sibling alone", () => {
    const bin = join(tempDir("pier-kimi-shared-"), "bin");
    mkdirSync(bin);
    const kimi = join(bin, "kimi");
    writeFileSync(kimi, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    chmodSync(kimi, 0o755);
    writeFileSync(join(bin, "kimi-cli"), UV_SHIM);
    expect(isKimiCodeInstallPath(kimi)).toBe(false);
    expect(isLegacyKimiCliInstall(kimi)).toBe(false);
  });
});
