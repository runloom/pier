import en from "@plugins/builtin/files/locales/en.json" with { type: "json" };
import zhCn from "@plugins/builtin/files/locales/zh-CN.json" with {
  type: "json",
};
import { createFilesTranslate } from "@plugins/builtin/files/renderer/files-i18n.ts";
import { describe, expect, it } from "vitest";

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

describe("files delete translations", () => {
  it.each([
    [en.messages, "README.md", "Delete “README.md”?"],
    [zhCn.messages, "README.md", "确定删除“README.md”吗？"],
  ])("includes the target name in localized confirmation", (messages, name, expected) => {
    const t = translator(messages);

    expect(t("filePanel.tree.delete.body", undefined, { name })).toContain(
      expected
    );
  });

  it.each([
    [en.messages, "3 items"],
    [zhCn.messages, "3 项"],
  ])("includes the multi-selection count", (messages, expected) => {
    const t = translator(messages);

    expect(t("filePanel.tree.delete.multi", undefined, { count: 3 })).toBe(
      expected
    );
  });
});
