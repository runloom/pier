import { describe, expect, it } from "vitest";
import en from "../../../../src/plugins/builtin/git/locales/en.json" with {
  type: "json",
};
import { GIT_PLUGIN_LOCALES } from "../../../../src/plugins/builtin/git/locales/index.ts";
import zh from "../../../../src/plugins/builtin/git/locales/zh-CN.json" with {
  type: "json",
};

const REQUIRED = [
  "ui.reviewCommentToolbar",
  "ui.reviewCommentPosition",
  "ui.reviewCommentClear",
  "ui.reviewCommentClearTitle",
  "ui.reviewCommentClearBody",
  "ui.reviewCommentClearConfirm",
  "ui.reviewCommentClearFailed",
  "ui.reviewCommentPrevious",
  "ui.reviewCommentNext",
] as const;

describe("review comment navigator i18n", () => {
  it("keeps navigator copy under messages (pluginText resolution)", () => {
    for (const key of REQUIRED) {
      expect(en.messages[key], `en missing ${key}`).toEqual(expect.any(String));
      expect(zh.messages[key], `zh missing ${key}`).toEqual(expect.any(String));
      // Root-level keys are invisible to resolvePluginMessage.
      expect((en as Record<string, unknown>)[key]).toBeUndefined();
      expect((zh as Record<string, unknown>)[key]).toBeUndefined();
      expect(
        (GIT_PLUGIN_LOCALES.en as Record<string, unknown>)[key]
      ).toBeUndefined();
      expect(GIT_PLUGIN_LOCALES.en.messages?.[key]).toEqual(expect.any(String));
      expect(GIT_PLUGIN_LOCALES["zh-CN"].messages?.[key]).toEqual(
        expect.any(String)
      );
    }
    expect(en.messages["ui.reviewCommentClear"]).toBe("Clear all");
    expect(zh.messages["ui.reviewCommentClear"]).toBe("清除全部");
    expect(
      GIT_PLUGIN_LOCALES["zh-CN"].messages?.["ui.reviewCommentClear"]
    ).toBe("清除全部");
    expect(en.messages["ui.reviewCommentPosition"]).toContain("{{current}}");
    expect(zh.messages["ui.reviewCommentPosition"]).toContain("{{total}}");
  });
});
