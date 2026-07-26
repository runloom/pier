import {
  isAsarPackagedPath,
  resolveEsbuildBinaryPath,
  unpackedEsbuildBinaryPath,
} from "@main/services/live-modules/esbuild-binary.ts";
import { describe, expect, it } from "vitest";

const PACKAGED =
  "/Applications/Pier.app/Contents/Resources/app.asar/node_modules/@esbuild/darwin-arm64/bin/esbuild";
const DEV =
  "/Users/dev/pier/node_modules/.pnpm/@esbuild+darwin-arm64@0.28.1/node_modules/@esbuild/darwin-arm64/bin/esbuild";

describe("live modules esbuild binary path", () => {
  it("rewrites a packaged asar path to the unpacked sibling", () => {
    // asar is a single file — spawning the binary from inside it fails ENOTDIR.
    expect(unpackedEsbuildBinaryPath(PACKAGED)).toBe(
      "/Applications/Pier.app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/darwin-arm64/bin/esbuild"
    );
  });

  it("leaves dev paths untouched", () => {
    expect(isAsarPackagedPath(DEV)).toBe(false);
    expect(unpackedEsbuildBinaryPath(DEV)).toBe(DEV);
  });

  it("detects packaged paths", () => {
    expect(isAsarPackagedPath(PACKAGED)).toBe(true);
  });

  it("does not rewrite a path that merely mentions asar elsewhere", () => {
    const unpacked =
      "/Applications/Pier.app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/darwin-arm64/bin/esbuild";
    expect(isAsarPackagedPath(unpacked)).toBe(false);
    expect(unpackedEsbuildBinaryPath(unpacked)).toBe(unpacked);
  });
});

describe("resolveEsbuildBinaryPath", () => {
  it("returns the unpacked path when packaged and the sibling exists", () => {
    expect(
      resolveEsbuildBinaryPath({
        currentEnvPath: undefined,
        resolvedPlatformBinary: PACKAGED,
        unpackedExists: true,
      })
    ).toBe(unpackedEsbuildBinaryPath(PACKAGED));
  });

  it("returns null in dev (non-asar path)", () => {
    expect(
      resolveEsbuildBinaryPath({
        currentEnvPath: undefined,
        resolvedPlatformBinary: DEV,
        unpackedExists: true,
      })
    ).toBeNull();
  });

  it("returns null when the unpacked copy is missing (asarUnpack drifted)", () => {
    expect(
      resolveEsbuildBinaryPath({
        currentEnvPath: undefined,
        resolvedPlatformBinary: PACKAGED,
        unpackedExists: false,
      })
    ).toBeNull();
  });

  it("leaves an explicit env override in place", () => {
    expect(
      resolveEsbuildBinaryPath({
        currentEnvPath: "/custom/esbuild",
        resolvedPlatformBinary: PACKAGED,
        unpackedExists: true,
      })
    ).toBeNull();
  });
});
