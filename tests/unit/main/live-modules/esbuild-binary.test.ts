import * as esbuildBinaryModule from "@main/services/live-modules/esbuild-binary.ts";
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

describe("temporary esbuild binary path", () => {
  type WithTemporaryEsbuildBinaryPath = <T>(input: {
    binaryPath: string | null;
    env: NodeJS.ProcessEnv;
    load: () => T;
  }) => T;
  const withTemporaryEsbuildBinaryPath = (
    esbuildBinaryModule as {
      withTemporaryEsbuildBinaryPath?: WithTemporaryEsbuildBinaryPath;
    }
  ).withTemporaryEsbuildBinaryPath;

  it("restores the process environment after loading esbuild", async () => {
    expect(withTemporaryEsbuildBinaryPath).toBeTypeOf("function");
    if (!withTemporaryEsbuildBinaryPath) {
      return;
    }
    const env: NodeJS.ProcessEnv = {};
    let observedPath: string | undefined;

    await withTemporaryEsbuildBinaryPath({
      binaryPath: PACKAGED,
      env,
      load: async () => {
        observedPath = env.ESBUILD_BINARY_PATH;
        return "loaded";
      },
    });

    expect(observedPath).toBe(PACKAGED);
    expect(env.ESBUILD_BINARY_PATH).toBeUndefined();
  });

  it("restores the previous environment when loading esbuild fails", async () => {
    expect(withTemporaryEsbuildBinaryPath).toBeTypeOf("function");
    if (!withTemporaryEsbuildBinaryPath) {
      return;
    }
    const env: NodeJS.ProcessEnv = {
      ESBUILD_BINARY_PATH: "/custom/esbuild",
    };

    await expect(
      withTemporaryEsbuildBinaryPath({
        binaryPath: PACKAGED,
        env,
        load: () => Promise.reject(new Error("load failed")),
      })
    ).rejects.toThrow("load failed");

    expect(env.ESBUILD_BINARY_PATH).toBe("/custom/esbuild");
  });

  it("restores the environment before an asynchronous result settles", async () => {
    expect(withTemporaryEsbuildBinaryPath).toBeTypeOf("function");
    if (!withTemporaryEsbuildBinaryPath) {
      return;
    }
    const env: NodeJS.ProcessEnv = {};
    let resolveLoad: (value: string) => void = () => undefined;
    const pending = withTemporaryEsbuildBinaryPath({
      binaryPath: PACKAGED,
      env,
      load: () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    });

    expect(env.ESBUILD_BINARY_PATH).toBeUndefined();
    resolveLoad("loaded");
    await expect(pending).resolves.toBe("loaded");
  });
});
