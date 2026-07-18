import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  requiredMacReleaseAssetNames,
  validateLatestMacYmlFiles,
  validateMacReleaseAssetNames,
} from "../../../scripts/mac-release-assets.mjs";
import {
  collectPublishFiles,
  parseArgs as parsePublishArgs,
} from "../../../scripts/publish-mac-release-artifacts.mjs";
import { validateLatestRelease } from "../../../scripts/verify-github-latest-isolation.mjs";
import {
  parseArgs,
  validateMacReleaseArtifacts,
} from "../../../scripts/verify-mac-release-artifacts.mjs";

const COMPLETE_0_1_1 = requiredMacReleaseAssetNames("0.1.1");

describe("mac release dual-arch assets", () => {
  it("lists electron-builder default dual-arch names", () => {
    expect(requiredMacReleaseAssetNames("v0.1.1")).toEqual([
      "latest-mac.yml",
      "Pier-0.1.1-arm64-mac.zip",
      "Pier-0.1.1-mac.zip",
      "Pier-0.1.1-arm64.dmg",
      "Pier-0.1.1.dmg",
    ]);
  });

  it("rejects incomplete asset sets like the broken v0.1.1 release", () => {
    const errors = validateMacReleaseAssetNames(
      [
        "latest-mac.yml",
        "Pier-0.1.1-arm64-mac.zip",
        "Pier-0.1.1-mac.zip",
        "Pier-0.1.1.dmg",
      ],
      "0.1.1"
    );
    expect(errors.join("\n")).toMatch(/Pier-0\.1\.1-arm64\.dmg/);
  });

  it("accepts a complete dual-arch set", () => {
    expect(validateMacReleaseAssetNames(COMPLETE_0_1_1, "0.1.1")).toEqual([]);
  });

  it("requires latest-mac.yml files to list both zips and both dmgs", () => {
    const incomplete = `
version: 0.1.1
files:
  - url: Pier-0.1.1-mac.zip
  - url: Pier-0.1.1-arm64-mac.zip
  - url: Pier-0.1.1.dmg
path: Pier-0.1.1-mac.zip
`;
    expect(validateLatestMacYmlFiles(incomplete, "0.1.1").join("\n")).toMatch(
      /Pier-0\.1\.1-arm64\.dmg/
    );

    const complete = `
version: 0.1.1
files:
  - url: Pier-0.1.1-mac.zip
  - url: Pier-0.1.1-arm64-mac.zip
  - url: Pier-0.1.1.dmg
  - url: Pier-0.1.1-arm64.dmg
path: Pier-0.1.1-mac.zip
`;
    expect(validateLatestMacYmlFiles(complete, "0.1.1")).toEqual([]);
  });

  it("validateMacReleaseArtifacts combines dir names and yml content", () => {
    const yml = `
version: 0.1.1
files:
  - url: Pier-0.1.1-mac.zip
  - url: Pier-0.1.1-arm64-mac.zip
  - url: Pier-0.1.1.dmg
  - url: Pier-0.1.1-arm64.dmg
`;
    expect(
      validateMacReleaseArtifacts({
        assetNames: COMPLETE_0_1_1,
        version: "0.1.1",
        latestMacYmlText: yml,
      })
    ).toEqual([]);
  });

  it("parseArgs reads dir/version/assets", () => {
    expect(
      parseArgs([
        "--dir",
        "dist-builder",
        "--version",
        "0.1.1",
        "--assets",
        "a.zip,b.dmg",
      ])
    ).toEqual({
      dir: "dist-builder",
      version: "0.1.1",
      assets: ["a.zip", "b.dmg"],
    });
  });
});

describe("publish-mac-release-artifacts helpers", () => {
  it("parseArgs reads dir/version/policy", () => {
    expect(
      parsePublishArgs([
        "--dir",
        "dist-builder",
        "--version",
        "0.1.1",
        "--policy",
        "always",
      ])
    ).toEqual({
      dir: "dist-builder",
      version: "0.1.1",
      policy: "always",
    });
  });

  it("collectPublishFiles requires dual-arch set and includes blockmaps when present", async () => {
    const files = await collectPublishFiles("dist-builder", "0.1.0");
    const names = files.map((f) => f.split(/[\\/]/).at(-1));
    expect(names).toEqual(
      expect.arrayContaining([
        "latest-mac.yml",
        "Pier-0.1.0-arm64-mac.zip",
        "Pier-0.1.0-mac.zip",
        "Pier-0.1.0-arm64.dmg",
        "Pier-0.1.0.dmg",
        "Pier-0.1.0-arm64-mac.zip.blockmap",
        "Pier-0.1.0-mac.zip.blockmap",
        "Pier-0.1.0-arm64.dmg.blockmap",
        "Pier-0.1.0.dmg.blockmap",
      ])
    );
  });
});

describe("GitHub Latest isolation dual-arch gate", () => {
  it("rejects latest missing arm64 dmg even when yml+zip exist", () => {
    const errors = validateLatestRelease(
      {
        tag_name: "v0.1.1",
        draft: false,
        prerelease: false,
        assets: [
          { name: "latest-mac.yml" },
          { name: "Pier-0.1.1-arm64-mac.zip" },
          { name: "Pier-0.1.1-mac.zip" },
          { name: "Pier-0.1.1.dmg" },
        ],
      },
      { expectVersion: "0.1.1" }
    );
    expect(errors.join("\n")).toMatch(/arm64\.dmg/i);
  });

  it("accepts complete dual-arch host latest", () => {
    expect(
      validateLatestRelease(
        {
          tag_name: "v0.1.1",
          draft: false,
          prerelease: false,
          assets: COMPLETE_0_1_1.map((name) => ({ name })),
        },
        { expectVersion: "0.1.1" }
      )
    ).toEqual([]);
  });

  it("requires dual-arch assets from tag even without expectVersion", () => {
    const errors = validateLatestRelease({
      tag_name: "v0.1.1",
      draft: false,
      prerelease: false,
      assets: [
        { name: "latest-mac.yml" },
        { name: "Pier-0.1.1-arm64-mac.zip" },
      ],
    });
    expect(errors.join("\n")).toMatch(/Pier-0\.1\.1-mac\.zip/);
    expect(errors.join("\n")).toMatch(/Pier-0\.1\.1-arm64\.dmg/);
    expect(errors.join("\n")).toMatch(/Pier-0\.1\.1\.dmg/);
  });
});
describe("build-dist and release-app dual-arch wiring", () => {
  it("builds with publish never, verifies, then publishes via fail-hard wrapper", async () => {
    const buildDist = await readFile(
      join(process.cwd(), "scripts/build-dist.sh"),
      "utf8"
    );
    expect(buildDist).toContain("--publish never");
    expect(buildDist).toContain("verify-mac-release-artifacts.mjs");
    expect(buildDist).toContain("publish-mac-release-artifacts.mjs");
    expect(buildDist).toMatch(
      /electron-builder --mac --arm64 --x64 --publish never/
    );
    // Must not publish during the pack step.
    expect(buildDist).not.toMatch(
      /electron-builder --mac --arm64 --x64 --publish "\$PUBLISH_POLICY"/
    );
    // Must not call the flaky CLI publish path.
    expect(buildDist).not.toMatch(/^\s*pnpm exec electron-builder publish\b/m);
  });

  it("release-app verifies dual-arch artifacts after build", async () => {
    const source = await readFile(
      join(process.cwd(), ".github/workflows/release-app.yml"),
      "utf8"
    );
    expect(source).toContain("verify-mac-release-artifacts.mjs");
    expect(source).toContain("verify-github-latest-isolation.mjs");
    expect(source).toContain("--expect-version");
  });
});
