import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAC_FOLDER_USAGE_DESCRIPTIONS,
  MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS,
  MAC_INFO_PLIST_STRINGS_LOCALE_DIRS,
  MAC_INFO_PLIST_STRINGS_RELATIVE_PATHS,
  renderInfoPlistStrings,
} from "../../../scripts/mac-privacy-descriptions.mjs";
import { validatePackagedMacApp } from "../../../scripts/verify-mac-release-artifacts.mjs";

const ROOT = process.cwd();

const EXPECTED_KEYS = [
  "NSAppleEventsUsageDescription",
  "NSDesktopFolderUsageDescription",
  "NSDocumentsFolderUsageDescription",
  "NSDownloadsFolderUsageDescription",
  "NSFileProviderDomainUsageDescription",
  "NSNetworkVolumesUsageDescription",
  "NSRemovableVolumesUsageDescription",
];

function extendInfoValue(source: string, key: string): string | undefined {
  return source.match(new RegExp(`^\\s+${key}: "(.*)"\\s*$`, "m"))?.[1];
}

describe("macOS TCC usage descriptions", () => {
  it("covers folders, sync providers and Apple Events in both locales", () => {
    expect(Object.keys(MAC_FOLDER_USAGE_DESCRIPTIONS).sort()).toEqual(
      EXPECTED_KEYS
    );
    expect(Object.keys(MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS).sort()).toEqual(
      EXPECTED_KEYS
    );
  });

  it("keeps the Info.plist fallback English-only and readable", () => {
    for (const [key, value] of Object.entries(MAC_FOLDER_USAGE_DESCRIPTIONS)) {
      expect(value, key).toMatch(/^Pier needs /);
      expect(value, key).not.toMatch(/[\u4e00-\u9fff]/);
      expect(value.trim(), key).toBe(value);
    }
  });

  it("keeps the zh-Hans localization Chinese-first and readable", () => {
    for (const [key, value] of Object.entries(
      MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS
    )) {
      expect(value, key).toMatch(/^Pier 需要/);
      expect(value, key).toMatch(/[\u4e00-\u9fff]/);
      expect(value, key).not.toMatch(/needs/);
      expect(value.trim(), key).toBe(value);
    }
  });

  it("matches the terms macOS uses in the zh_CN TCC prompts", () => {
    // 来源：TCC.framework Localizable.loctable 的 zh_CN 分组（系统弹窗第一句
    // 与本说明并排显示）。注意是「可移除宗卷」不是「可移动宗卷」。
    const systemTerms: Record<string, string> = {
      NSAppleEventsUsageDescription: "控制其他 App",
      NSDesktopFolderUsageDescription: "“桌面”文件夹",
      NSDocumentsFolderUsageDescription: "“文稿”文件夹",
      NSDownloadsFolderUsageDescription: "“下载”文件夹",
      NSFileProviderDomainUsageDescription: "iCloud 云盘",
      NSNetworkVolumesUsageDescription: "网络宗卷",
      NSRemovableVolumesUsageDescription: "可移除宗卷",
    };
    for (const [key, term] of Object.entries(systemTerms)) {
      expect(
        MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS[
          key as keyof typeof MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS
        ],
        key
      ).toContain(term);
    }
  });

  it("electron-builder.yml extendInfo carries the English fallback", async () => {
    const yml = await readFile(join(ROOT, "electron-builder.yml"), "utf8");
    for (const [key, value] of Object.entries(MAC_FOLDER_USAGE_DESCRIPTIONS)) {
      expect(extendInfoValue(yml, key), key).toBe(value);
    }
  });

  it("ships both Simplified-Chinese lproj tables via extraResources", async () => {
    const yml = await readFile(join(ROOT, "electron-builder.yml"), "utf8");
    expect(MAC_INFO_PLIST_STRINGS_LOCALE_DIRS).toEqual([
      "zh-Hans.lproj",
      "zh_CN.lproj",
    ]);
    for (const relative of MAC_INFO_PLIST_STRINGS_RELATIVE_PATHS) {
      expect(yml).toContain(`from: build/${relative}`);
      expect(yml).toContain(`to: ${relative}`);
    }
  });

  it("generated build strings tables match the constants", async () => {
    for (const relative of MAC_INFO_PLIST_STRINGS_RELATIVE_PATHS) {
      const actual = await readFile(join(ROOT, "build", relative), "utf8");
      expect(actual, relative).toBe(
        renderInfoPlistStrings(MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS)
      );
    }
  });

  it("escapes quotes and backslashes in .strings values", () => {
    expect(renderInfoPlistStrings({ K: 'a "b" \\ c' })).toContain(
      '"K" = "a \\"b\\" \\\\ c";'
    );
  });

  it("PierDev dev shell installs the same fallback and localization", async () => {
    const source = await readFile(
      join(ROOT, "scripts/dev-profile.mjs"),
      "utf8"
    );
    expect(source).toContain("...MAC_FOLDER_USAGE_DESCRIPTIONS,");
    expect(source).toContain(
      "renderInfoPlistStrings(MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS)"
    );
    expect(source).toContain("MAC_INFO_PLIST_STRINGS_RELATIVE_PATHS");
  });
});

describe("packaged-app usage description gate", () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  async function writePackagedFixture(options: {
    plistEntries: Record<string, string>;
    localizedStrings?: Partial<Record<string, string>>;
  }): Promise<string> {
    const root = join(
      tmpdir(),
      `pier-usage-desc-${Math.random().toString(36).slice(2)}`
    );
    roots.push(root);
    const app = join(root, "Pier.app");
    await mkdir(join(app, "Contents"), { recursive: true });
    await writeFile(
      join(app, "Contents", "Info.plist"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0"><dict>',
        ...Object.entries(options.plistEntries).map(
          ([key, value]) => `<key>${key}</key><string>${value}</string>`
        ),
        "</dict></plist>",
      ].join("\n"),
      "utf8"
    );
    for (const [relative, contents] of Object.entries(
      options.localizedStrings ?? {}
    )) {
      if (contents === undefined) {
        continue;
      }
      const stringsPath = join(app, "Contents", "Resources", relative);
      await mkdir(dirname(stringsPath), { recursive: true });
      await writeFile(stringsPath, contents, "utf8");
    }
    return app;
  }

  function fullLocalizedStrings(): Record<string, string> {
    const rendered = renderInfoPlistStrings(
      MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS
    );
    return Object.fromEntries(
      MAC_INFO_PLIST_STRINGS_RELATIVE_PATHS.map((relative) => [
        relative,
        rendered,
      ])
    );
  }

  it("passes when fallback strings and both zh tables are present", async () => {
    const app = await writePackagedFixture({
      plistEntries: {
        CFBundleIdentifier: "io.pier.app",
        ...MAC_FOLDER_USAGE_DESCRIPTIONS,
      },
      localizedStrings: fullLocalizedStrings(),
    });
    const errors = await validatePackagedMacApp(app);
    expect(
      errors.filter(
        (e) => e.includes("UsageDescription") || e.includes("InfoPlist.strings")
      )
    ).toEqual([]);
  });

  it("rejects a bundle missing a fallback key or drifting a localization", async () => {
    const { NSDesktopFolderUsageDescription: _dropped, ...rest } =
      MAC_FOLDER_USAGE_DESCRIPTIONS;
    const app = await writePackagedFixture({
      plistEntries: { CFBundleIdentifier: "io.pier.app", ...rest },
      localizedStrings: {
        ...fullLocalizedStrings(),
        "zh_CN.lproj/InfoPlist.strings":
          '"NSDesktopFolderUsageDescription" = "drifted";\n',
      },
    });
    const errors = await validatePackagedMacApp(app);
    expect(errors.join("\n")).toMatch(
      /NSDesktopFolderUsageDescription.*received missing/
    );
    expect(errors.join("\n")).toMatch(
      /zh_CN\.lproj\/InfoPlist\.strings drifted.*--write/
    );
  });

  it("rejects a bundle missing either zh strings table", async () => {
    const app = await writePackagedFixture({
      plistEntries: {
        CFBundleIdentifier: "io.pier.app",
        ...MAC_FOLDER_USAGE_DESCRIPTIONS,
      },
      localizedStrings: {
        "zh-Hans.lproj/InfoPlist.strings": renderInfoPlistStrings(
          MAC_FOLDER_USAGE_DESCRIPTIONS_ZH_HANS
        ),
      },
    });
    const errors = await validatePackagedMacApp(app);
    expect(errors.join("\n")).toMatch(
      /missing zh_CN\.lproj\/InfoPlist\.strings/
    );
    expect(errors.join("\n")).not.toMatch(/missing zh-Hans\.lproj/);
  });
});
