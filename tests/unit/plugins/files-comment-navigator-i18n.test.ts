import { describe, expect, it } from "vitest";
import en from "../../../src/plugins/builtin/files/locales/en.json" with {
  type: "json",
};
import zh from "../../../src/plugins/builtin/files/locales/zh-CN.json" with {
  type: "json",
};
import { createCommentNavigatorLabels } from "../../../src/plugins/builtin/files/renderer/comments/use-comment-navigator.ts";
import { createFilesTranslate } from "../../../src/plugins/builtin/files/renderer/i18n.ts";

const REQUIRED = [
  "filePanel.commentNav.toolbar",
  "filePanel.commentNav.position",
  "filePanel.commentNav.clear",
  "filePanel.commentNav.clearTitle",
  "filePanel.commentNav.clearBody",
  "filePanel.commentNav.clearConfirm",
  "filePanel.commentNav.clearFailed",
  "filePanel.commentNav.previous",
  "filePanel.commentNav.next",
] as const;

function translator(messages: Record<string, string>) {
  return createFilesTranslate({
    i18n: {
      t(
        key: string,
        values?: Record<string, number | string>,
        fallback?: string
      ) {
        const template = messages[key] ?? fallback ?? key;
        return Object.entries(values ?? {}).reduce(
          (message, [name, value]) =>
            message.replaceAll(`{{${name}}}`, String(value)),
          template
        );
      },
    } as never,
  });
}

describe("files comment navigator i18n", () => {
  it("keeps markdown/canvas navigator copy in locale messages", () => {
    for (const key of REQUIRED) {
      expect(en.messages[key], `en missing ${key}`).toEqual(expect.any(String));
      expect(zh.messages[key], `zh missing ${key}`).toEqual(expect.any(String));
    }
    expect(en.messages["filePanel.commentNav.clear"]).toBe("Clear all");
    expect(zh.messages["filePanel.commentNav.clear"]).toBe("清除全部");
    expect(en.messages["filePanel.commentNav.position"]).toContain(
      "{{current}}"
    );
    expect(zh.messages["filePanel.commentNav.position"]).toContain("{{total}}");
  });

  it("resolves zh-CN labels through createCommentNavigatorLabels", () => {
    const labels = createCommentNavigatorLabels(translator(zh.messages));
    expect(labels.clearLabel).toBe("清除全部");
    expect(labels.clearTitle).toBe("清除全部评论？");
    expect(labels.clearBody).toContain("无法撤销");
    expect(labels.clearConfirm).toBe("清除");
    expect(labels.previousLabel).toBe("上一条评论");
    expect(labels.nextLabel).toBe("下一条评论");
    expect(labels.toolbarLabel).toBe("评论");
    expect(labels.positionTemplate).toBe(
      "第 {{current}} 条，共 {{total}} 条评论"
    );
  });

  it("resolves en labels through createCommentNavigatorLabels", () => {
    const labels = createCommentNavigatorLabels(translator(en.messages));
    expect(labels.clearLabel).toBe("Clear all");
    expect(labels.previousLabel).toBe("Previous comment");
    expect(labels.nextLabel).toBe("Next comment");
    expect(labels.positionTemplate).toContain("{{current}}");
  });
});
