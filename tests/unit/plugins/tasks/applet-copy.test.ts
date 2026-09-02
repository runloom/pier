import { describe, expect, it } from "vitest";
import { en } from "../../../../packages/plugin-tasks/applets/copy/en.ts";
import {
  columnLabel,
  resolveAppletLocale,
  startReadyLabel,
  type Translate,
  translate,
} from "../../../../packages/plugin-tasks/applets/copy/index.ts";
import { ja } from "../../../../packages/plugin-tasks/applets/copy/ja.ts";
import { ko } from "../../../../packages/plugin-tasks/applets/copy/ko.ts";
import { zhCN } from "../../../../packages/plugin-tasks/applets/copy/zh-CN.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

describe("task applet copy catalogs", () => {
  it("keeps the same keys in every shipped language", () => {
    const expected = Object.keys(en).toSorted();
    expect(Object.keys(zhCN).toSorted()).toEqual(expected);
    expect(Object.keys(ja).toSorted()).toEqual(expected);
    expect(Object.keys(ko).toSorted()).toEqual(expected);
  });

  it("interpolates placeholders and falls back to English", () => {
    expect(translate("zh-CN", "view.startReadyMany", { count: 3 })).toContain(
      "3"
    );
    expect(translate("zz", "view.refresh")).toBe(en["view.refresh"]);
    expect(translate("en", "edge.jumpTo", { key: "#12" })).toBe("Jump to #12");
    expect(translate("en", "edge.jumpTo")).toBe("Jump to {{key}}");
  });

  it("reads the UI language from preferences and follows system otherwise", () => {
    expect(resolveAppletLocale({ language: "zh-CN" })).toBe("zh-CN");
    expect(resolveAppletLocale({ language: "system" })).toBe(
      resolveAppletLocale({})
    );
  });

  it("translates generic lane names and keeps custom tracker titles", () => {
    expect(columnLabel({ id: "todo", title: "Backlog" }, "heuristic", t)).toBe(
      en["column.todo"]
    );
    expect(columnLabel({ id: "todo", title: "Todo" }, "project", t)).toBe(
      en["column.todo"]
    );
    expect(columnLabel({ id: "todo", title: "工程就绪" }, "project", t)).toBe(
      "工程就绪"
    );
    expect(startReadyLabel(0, t)).toBe(en["view.startReady"]);
    expect(startReadyLabel(1, t)).toBe(en["view.startReadyOne"]);
    expect(startReadyLabel(4, t)).toBe("Start 4 ready tasks");
  });
});
