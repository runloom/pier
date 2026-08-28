import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installMacHelperIcons,
  MAC_HELPER_SUFFIXES,
  rootPlistStringValue,
} from "../../../scripts/mac-helper-icons.mjs";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function makeFixture(options: { omitSuffix?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pier-mac-helpers-"));
  tempDirectories.push(root);
  const app = join(root, "Pier.app");
  const frameworks = join(app, "Contents", "Frameworks");
  const icon = join(root, "canonical.icns");
  await writeFile(icon, "canonical-pier-icon");

  for (const suffix of MAC_HELPER_SUFFIXES) {
    if (suffix === options.omitSuffix) {
      continue;
    }
    const contents = join(frameworks, `Pier Helper${suffix}.app`, "Contents");
    const resources = join(contents, "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(contents, "Info.plist"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0"><dict>',
        "<key>LSEnvironment</key><dict>",
        "<key>MallocNanoZone</key><string>0</string>",
        "</dict>",
        "<key>CFBundleIconFile</key><string>electron.icns</string>",
        "<key>CFBundleIconName</key><string>stale-layered-icon</string>",
        "</dict></plist>",
      ].join("\n")
    );
    for (const stale of ["electron.icns", "AppIcon.icns", "Assets.car"]) {
      await writeFile(join(resources, stale), `stale-${stale}`);
    }
  }
  return { app, icon };
}

describe("production macOS Helper branding", () => {
  it("distinguishes an absent root key from a non-string root value", () => {
    const plist = [
      '<plist version="1.0"><dict>',
      "<key>LSEnvironment</key><dict>",
      "<key>CFBundleIconName</key><string>nested</string>",
      "</dict>",
      "<key>CFBundleIconName</key><true/>",
      "</dict></plist>",
    ].join("\n");

    expect(rootPlistStringValue(plist, "CFBundleIconName")).toBeNull();
    expect(rootPlistStringValue(plist, "CFBundleIconFile")).toBeUndefined();
  });

  it("installs exactly the canonical ICNS into all four Helpers", async () => {
    const { app, icon } = await makeFixture();
    const canonical = await readFile(icon);

    await installMacHelperIcons(app, { iconPath: icon });

    for (const suffix of MAC_HELPER_SUFFIXES) {
      const contents = join(
        app,
        "Contents",
        "Frameworks",
        `Pier Helper${suffix}.app`,
        "Contents"
      );
      const resources = join(contents, "Resources");
      expect(await readFile(join(resources, "icon.icns"))).toEqual(canonical);
      const plist = await readFile(join(contents, "Info.plist"), "utf8");
      expect(plist).toMatch(
        /<key>\s*CFBundleIconFile\s*<\/key>\s*<string>\s*icon\.icns\s*<\/string>/
      );
      expect(plist).not.toContain("CFBundleIconName");
      const environment =
        /<key>\s*LSEnvironment\s*<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(
          plist
        )?.[1];
      expect(environment).toBeDefined();
      expect(environment).not.toContain("CFBundleIconFile");
      expect(plist.indexOf("CFBundleIconFile")).toBeGreaterThan(
        plist.indexOf("</dict>")
      );
      await expect(
        readFile(join(resources, "electron.icns"))
      ).rejects.toThrow();
      await expect(readFile(join(resources, "AppIcon.icns"))).rejects.toThrow();
      await expect(readFile(join(resources, "Assets.car"))).rejects.toThrow();
    }
  });

  it("fails before changing any Helper when the package is incomplete", async () => {
    const missing = " (Renderer)";
    const { app, icon } = await makeFixture({ omitSuffix: missing });
    const untouched = join(
      app,
      "Contents",
      "Frameworks",
      "Pier Helper.app",
      "Contents",
      "Resources",
      "electron.icns"
    );

    await expect(
      installMacHelperIcons(app, { iconPath: icon })
    ).rejects.toThrow(/Pier Helper \(Renderer\)\.app/);
    await expect(readFile(untouched, "utf8")).resolves.toBe(
      "stale-electron.icns"
    );
  });
});
