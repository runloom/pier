import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { en } from "@/i18n/locales/en/index.ts";
import { zhCN } from "@/i18n/locales/zh-CN/index.ts";
import { getCategory } from "@/lib/actions/contribution-runtime.ts";
import type { ActionCategoryKey } from "@/lib/actions/types.ts";

/**
 * aliases JSON 迁移后回归测试：
 * resolveI18nAliases 的底层 getResourceBundle 仍能沿
 * commandPalette.aliases.* 路径正确解析 alias 数组。
 */
describe("aliases JSON migration", () => {
  beforeEach(async () => {
    await i18next.init({
      lng: "en",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      resources: {
        en: { translation: en },
        "zh-CN": { translation: zhCN },
      },
    });
  });

  afterEach(() => {
    i18next.removeResourceBundle("en", "translation");
    i18next.removeResourceBundle("zh-CN", "translation");
  });

  it("resolves host action aliases from JSON bundle (en)", () => {
    const bundle = i18next.getResourceBundle("en", "translation");
    const aliases =
      bundle?.commandPalette?.aliases?.pier?.panel?.equalizeSplits;
    expect(aliases).toEqual([
      "balance panels",
      "distribute panels",
      "even panels",
      "layout panels",
    ]);
  });

  it("resolves host action aliases from JSON bundle (zh-CN)", () => {
    const bundle = i18next.getResourceBundle("zh-CN", "translation");
    const aliases =
      bundle?.commandPalette?.aliases?.pier?.panel?.equalizeSplits;
    expect(aliases).toContain("平分面板");
    expect(aliases).toContain("均分面板");
  });

  it("theme aliases survive migration", () => {
    const bundle = i18next.getResourceBundle("en", "translation");
    const darkAliases = bundle?.commandPalette?.aliases?.theme?.dark;
    expect(darkAliases).toEqual(["dark", "dark mode"]);
  });

  it("locale aliases survive migration (zh-CN)", () => {
    const bundle = i18next.getResourceBundle("zh-CN", "translation");
    const zhCNAliases = bundle?.commandPalette?.aliases?.locale?.["zh-CN"];
    expect(zhCNAliases).toContain("中文");
    expect(zhCNAliases).toContain("简体中文");
  });

  it("non-alias UI strings preserved in commandPalette", () => {
    expect(i18next.t("commandPalette.title")).toBe("Command Palette");
    expect(i18next.t("commandPalette.empty")).toBe("No matching command");
    expect(i18next.t("commandPalette.action.newTab")).toBe("New Tab");
  });
});

describe("category i18n", () => {
  beforeEach(async () => {
    await i18next.init({
      lng: "en",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      resources: {
        en: { translation: en },
        "zh-CN": { translation: zhCN },
      },
    });
  });

  afterEach(() => {
    i18next.removeResourceBundle("en", "translation");
    i18next.removeResourceBundle("zh-CN", "translation");
  });

  it("getCategory resolves English category labels", () => {
    expect(getCategory("git")).toBe("Git");
    expect(getCategory("panel")).toBe("Panel");
    expect(getCategory("terminal")).toBe("Terminal");
    expect(getCategory("file")).toBe("File");
  });

  it("getCategory follows locale switch to zh-CN", async () => {
    await i18next.changeLanguage("zh-CN");
    expect(getCategory("panel")).toBe("面板");
    expect(getCategory("terminal")).toBe("终端");
    expect(getCategory("window")).toBe("窗口");
    expect(getCategory("file")).toBe("文件");
  });

  it("getCategory switches back to English", async () => {
    await i18next.changeLanguage("zh-CN");
    expect(getCategory("view")).toBe("视图");

    await i18next.changeLanguage("en");
    expect(getCategory("view")).toBe("View");
  });

  it("covers every ActionCategoryKey", () => {
    const allKeys: ActionCategoryKey[] = [
      "file",
      "git",
      "panel",
      "run",
      "settings",
      "terminal",
      "view",
      "window",
      "workspace",
      "worktree",
    ];
    for (const key of allKeys) {
      const label = getCategory(key);
      expect(label).toBeTruthy();
      expect(label).not.toBe(key);
    }
  });
});
