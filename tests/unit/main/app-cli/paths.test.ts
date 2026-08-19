import {
  isBlockedBinDir,
  looksLikePierAppCliTarget,
  packagedCliScriptPath,
  packagedCliSourcePath,
  resolveLinkCandidate,
} from "@main/services/app-cli/paths.ts";
import { describe, expect, it } from "vitest";

describe("app-cli paths", () => {
  it("points the packaged entry at Resources/bin/pier and pier.mjs", () => {
    const resources = "/Applications/Pier.app/Contents/Resources";
    expect(packagedCliSourcePath(resources)).toBe(
      "/Applications/Pier.app/Contents/Resources/bin/pier"
    );
    expect(packagedCliScriptPath(resources)).toBe(
      "/Applications/Pier.app/Contents/Resources/bin/pier.mjs"
    );
  });

  it("blocks system and app-bundle bin dirs", () => {
    expect(isBlockedBinDir("/usr/bin")).toBe(true);
    expect(isBlockedBinDir("/bin")).toBe(true);
    expect(isBlockedBinDir("/System/Cryptexes/App/usr/bin")).toBe(true);
    expect(isBlockedBinDir("/tmp/node_modules/.bin")).toBe(true);
    expect(
      isBlockedBinDir("/Applications/Other.app/Contents/Resources/bin")
    ).toBe(true);
    expect(isBlockedBinDir("/opt/homebrew/bin")).toBe(false);
  });

  it("prefers a writable Homebrew bin when it exists", () => {
    expect(
      resolveLinkCandidate({
        canWrite: (dir) => dir === "/opt/homebrew/bin",
        existsDir: (dir) =>
          dir === "/opt/homebrew/bin" || dir === "/usr/local/bin",
        home: "/Users/me",
        pathEnv: "/opt/homebrew/bin:/usr/bin:/bin",
        platform: "darwin",
      })
    ).toEqual({
      linkPath: "/opt/homebrew/bin/pier",
      needsAdmin: false,
    });
  });

  it("falls back to /usr/local/bin with admin when nothing is writable", () => {
    expect(
      resolveLinkCandidate({
        canWrite: () => false,
        existsDir: () => false,
        home: "/Users/me",
        pathEnv: "/usr/bin:/bin",
        platform: "darwin",
      })
    ).toEqual({
      linkPath: "/usr/local/bin/pier",
      needsAdmin: true,
    });
  });

  it("returns null on non-mac platforms", () => {
    expect(
      resolveLinkCandidate({
        canWrite: () => true,
        existsDir: () => true,
        home: "/home/me",
        pathEnv: "/usr/local/bin",
        platform: "linux",
      })
    ).toBeNull();
  });

  it("recognizes a Pier.app CLI target", () => {
    expect(
      looksLikePierAppCliTarget(
        "/Applications/Pier.app/Contents/Resources/bin/pier"
      )
    ).toBe(true);
    expect(looksLikePierAppCliTarget("/opt/homebrew/bin/pier")).toBe(false);
  });
});
