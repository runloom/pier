import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAC_HELPER_SUFFIXES } from "../../../../scripts/mac-helper-icons.mjs";
import {
  recommendedMacReleaseBlockmapNames,
  requiredMacReleaseAssetNames,
  validateLatestMacYmlFiles,
  validateMacReleaseAssetNames,
} from "../../../../scripts/mac-release-assets.mjs";
import {
  collectPublishFiles,
  parseArgs as parsePublishArgs,
  publishMacReleaseArtifacts,
  validateRemoteMacReleaseAssets,
} from "../../../../scripts/publish-mac-release-artifacts.mjs";
import { validateLatestRelease } from "../../../../scripts/verify-github-latest-isolation.mjs";
import {
  parseArgs,
  validateMacReleaseArtifacts,
  validatePackagedMacApp,
} from "../../../../scripts/verify-mac-release-artifacts.mjs";

const COMPLETE_0_1_1 = requiredMacReleaseAssetNames("0.1.1");

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeArtifactDir(
  version: string,
  opts: { omit?: string[]; withBlockmaps?: boolean } = {}
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-mac-release-"));
  tempDirs.push(dir);
  const names = requiredMacReleaseAssetNames(version).filter(
    (n) => !(opts.omit ?? []).includes(n)
  );
  if (opts.withBlockmaps) {
    names.push(...recommendedMacReleaseBlockmapNames(version));
  }
  const ymlFiles = names
    .filter((n) => n !== "latest-mac.yml" && !n.endsWith(".blockmap"))
    .map((n) => `  - url: ${n}`)
    .join("\n");
  for (const name of names) {
    if (name === "latest-mac.yml") {
      await writeFile(
        join(dir, name),
        `version: ${version}\nfiles:\n${ymlFiles}\npath: Pier-${version}-mac.zip\n`,
        "utf8"
      );
    } else {
      await writeFile(join(dir, name), `${name}\n`, "utf8");
    }
  }
  await Promise.all([
    populatePackagedApp(join(dir, "mac/Pier.app")),
    populatePackagedApp(join(dir, "mac-arm64/Pier.app")),
  ]);
  return dir;
}

async function populatePackagedApp(app: string): Promise<void> {
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(
    join(contents, "Info.plist"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      "<key>CFBundleIdentifier</key><string>io.pier.app</string>",
      "<key>CFBundlePackageType</key><string>APPL</string>",
      "<key>CFBundleIconFile</key><string>icon.icns</string>",
      "<key>CFBundleIconName</key><string>app-icon</string>",
      "</dict></plist>",
    ].join("\n"),
    "utf8"
  );
  await copyFile(
    join(process.cwd(), "build/icon.icns"),
    join(resources, "icon.icns")
  );
  await copyFile(
    join(process.cwd(), "build/Assets.car"),
    join(resources, "Assets.car")
  );
  for (const suffix of MAC_HELPER_SUFFIXES) {
    const helperContents = join(
      contents,
      "Frameworks",
      `Pier Helper${suffix}.app`,
      "Contents"
    );
    const helperResources = join(helperContents, "Resources");
    await mkdir(helperResources, { recursive: true });
    await writeFile(
      join(helperContents, "Info.plist"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0"><dict>',
        `<key>CFBundleIdentifier</key><string>io.pier.app.helper${suffix.replace(/[^A-Za-z]/g, "").toLowerCase()}</string>`,
        "<key>CFBundlePackageType</key><string>APPL</string>",
        "<key>CFBundleIconFile</key><string>icon.icns</string>",
        "</dict></plist>",
      ].join("\n"),
      "utf8"
    );
    await copyFile(
      join(process.cwd(), "build/icon.icns"),
      join(helperResources, "icon.icns")
    );
  }
}

async function makePackagedAppFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-packaged-icon-"));
  tempDirs.push(root);
  const app = join(root, "Pier.app");
  await populatePackagedApp(app);
  return app;
}

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

  it("verifies the packaged app uses the exact release ICNS and native catalog", async () => {
    const app = await makePackagedAppFixture();
    await expect(validatePackagedMacApp(app)).resolves.toEqual([]);

    await writeFile(join(app, "Contents/Resources/Assets.car"), "stale-car");
    await expect(validatePackagedMacApp(app)).resolves.toEqual([
      expect.stringMatching(/Assets\.car.*build\/Assets\.car/i),
    ]);
  });

  it("rejects a packaged app without the native icon name", async () => {
    const app = await makePackagedAppFixture();
    const plist = join(app, "Contents/Info.plist");
    await writeFile(
      plist,
      (await readFile(plist, "utf8")).replace(
        "<string>app-icon</string>",
        "<string>other-icon</string>"
      ),
      "utf8"
    );
    await expect(validatePackagedMacApp(app)).resolves.toEqual([
      expect.stringMatching(/CFBundleIconName.*app-icon/),
    ]);
  });

  it("rejects stale or layered icon configuration in any Helper", async () => {
    const app = await makePackagedAppFixture();
    const helperContents = join(
      app,
      "Contents/Frameworks/Pier Helper (Renderer).app/Contents"
    );
    const helperResources = join(helperContents, "Resources");
    await writeFile(join(helperResources, "icon.icns"), "stale-helper-icon");
    await writeFile(join(helperResources, "Assets.car"), "stale-helper-car");
    const plist = join(helperContents, "Info.plist");
    await writeFile(
      plist,
      (await readFile(plist, "utf8")).replace(
        "</dict>",
        "<key>CFBundleIconName</key><string>stale</string></dict>"
      )
    );

    const errors = await validatePackagedMacApp(app);
    expect(errors.join("\n")).toMatch(/Pier Helper \(Renderer\).*icon\.icns/i);
    expect(errors.join("\n")).toMatch(/Pier Helper \(Renderer\).*Assets\.car/i);
    expect(errors.join("\n")).toMatch(
      /Pier Helper \(Renderer\).*CFBundleIconName/i
    );
  });

  it("rejects a Helper whose icon key exists only in a nested plist dictionary", async () => {
    const app = await makePackagedAppFixture();
    const plist = join(
      app,
      "Contents/Frameworks/Pier Helper.app/Contents/Info.plist"
    );
    await writeFile(
      plist,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0"><dict>',
        "<key>CFBundleIdentifier</key><string>io.pier.app.helper</string>",
        "<key>LSEnvironment</key><dict>",
        "<key>CFBundleIconFile</key><string>icon.icns</string>",
        "</dict>",
        "<key>CFBundlePackageType</key><string>APPL</string>",
        "</dict></plist>",
      ].join("\n"),
      "utf8"
    );

    const errors = await validatePackagedMacApp(app);
    expect(errors.join("\n")).toMatch(
      /Pier Helper\.app.*CFBundleIconFile.*missing/i
    );
  });
});

describe("publish-mac-release-artifacts helpers", () => {
  it("parseArgs reads dir/version/policy/repo", () => {
    expect(
      parsePublishArgs([
        "--dir",
        "dist-builder",
        "--version",
        "0.1.1",
        "--policy",
        "always",
        "--repo",
        "runloom/pier",
      ])
    ).toEqual({
      dir: "dist-builder",
      version: "0.1.1",
      policy: "always",
      repo: "runloom/pier",
    });
  });

  it("collectPublishFiles uses a temp fixture, not workspace dist-builder", async () => {
    const dir = await makeArtifactDir("0.1.0", { withBlockmaps: true });
    const files = await collectPublishFiles(dir, "0.1.0");
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

  it("collectPublishFiles rejects incomplete fixture dirs", async () => {
    const dir = await makeArtifactDir("0.1.1", {
      omit: ["Pier-0.1.1-arm64.dmg"],
    });
    await expect(collectPublishFiles(dir, "0.1.1")).rejects.toThrow();
  });

  it("validateRemoteMacReleaseAssets rejects missing arm64 dmg", () => {
    const errors = validateRemoteMacReleaseAssets({
      version: "0.1.1",
      assetNames: [
        "latest-mac.yml",
        "Pier-0.1.1-arm64-mac.zip",
        "Pier-0.1.1-mac.zip",
        "Pier-0.1.1.dmg",
      ],
    });
    expect(errors.join("\n")).toMatch(/arm64\.dmg/);
  });

  it("publishMacReleaseArtifacts hard-fails when remote assets stay incomplete", async () => {
    const dir = await makeArtifactDir("0.1.1", { withBlockmaps: true });
    const previousIgnore = process.env.EP_GH_IGNORE_TIME;
    try {
      await expect(
        publishMacReleaseArtifacts({
          dir,
          version: "0.1.1",
          policy: "always",
          repo: "runloom/pier",
          publishImpl: async () => [{ ok: true }],
          fetchRemoteAssetNames: () => [
            "latest-mac.yml",
            "Pier-0.1.1-arm64-mac.zip",
            "Pier-0.1.1-mac.zip",
            "Pier-0.1.1.dmg",
          ],
        })
      ).rejects.toThrow(/remote GitHub release still missing/i);
      expect(process.env.EP_GH_IGNORE_TIME).toBe("true");
    } finally {
      if (previousIgnore === undefined) {
        delete process.env.EP_GH_IGNORE_TIME;
      } else {
        process.env.EP_GH_IGNORE_TIME = previousIgnore;
      }
    }
  });

  it("publishMacReleaseArtifacts succeeds when remote dual-arch set is complete", async () => {
    const dir = await makeArtifactDir("0.1.1");
    const previousIgnore = process.env.EP_GH_IGNORE_TIME;
    try {
      const result = await publishMacReleaseArtifacts({
        dir,
        version: "0.1.1",
        policy: "always",
        repo: "runloom/pier",
        publishImpl: async () => [{ ok: true }],
        fetchRemoteAssetNames: () => COMPLETE_0_1_1,
      });
      expect(result.files).toEqual(expect.arrayContaining(COMPLETE_0_1_1));
      expect(process.env.EP_GH_IGNORE_TIME).toBe("true");
    } finally {
      if (previousIgnore === undefined) {
        delete process.env.EP_GH_IGNORE_TIME;
      } else {
        process.env.EP_GH_IGNORE_TIME = previousIgnore;
      }
    }
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
      /\[1\/6\] app icons[\s\S]*pnpm build:icons[\s\S]*\[6\/6\] electron-builder/
    );
    expect(buildDist).toMatch(
      /electron-builder --mac --arm64 --x64 --publish never/
    );
    expect(buildDist).not.toMatch(
      /electron-builder --mac --arm64 --x64 --publish "\$PUBLISH_POLICY"/
    );
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
