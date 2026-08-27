import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeDocumentFontFamily,
  computeMonoFontFamily,
  computeMonoFontFamilyList,
  detachFontListener,
  initFont,
  sanitizeDocFontPrimary,
  useFontStore,
} from "@/stores/font.store.ts";

describe("font.store — monoFontSize / codeFontSize", () => {
  beforeEach(() => {
    detachFontListener();
    useFontStore.setState({
      uiFontFamily: "",
      monoFontFamily: "",
      docFontMode: "ui",
      docFontFamily: "",
      monoFontSize: 13,
      codeFontSize: 13,
    });
  });

  afterEach(() => {
    detachFontListener();
  });

  it("默认 monoFontSize 与 codeFontSize 是 13", () => {
    expect(useFontStore.getState().monoFontSize).toBe(13);
    expect(useFontStore.getState().codeFontSize).toBe(13);
  });

  it("_hydrate 同时设置 family 与两套 size，并同步代码字号 CSS 变量", () => {
    useFontStore.getState()._hydrate({
      uiFontFamily: "",
      monoFontFamily: "Fira Code",
      docFontMode: "ui",
      docFontFamily: "",
      monoFontSize: 16,
      codeFontSize: 15,
    });
    const s = useFontStore.getState();
    expect(s.monoFontFamily).toBe("Fira Code");
    expect(s.monoFontSize).toBe(16);
    expect(s.codeFontSize).toBe(15);
    expect(
      document.documentElement.style.getPropertyValue("--pier-code-font-size")
    ).toBe("15px");
  });

  it("_hydrate custom document font 写入 --pier-document-font-family", () => {
    useFontStore.getState()._hydrate({
      uiFontFamily: "Inter",
      monoFontFamily: "",
      docFontMode: "custom",
      docFontFamily: "Noto Serif SC",
      monoFontSize: 13,
      codeFontSize: 13,
    });
    const doc = document.documentElement.style.getPropertyValue(
      "--pier-document-font-family"
    );
    expect(doc.startsWith('"Noto Serif SC"')).toBe(true);
    expect(doc).toContain("serif");
  });

  it("setMonoFontSize 调 IPC update 并写回 state", async () => {
    const updateMock = vi.fn(async (patch: { monoFontSize?: number }) => ({
      monoFontSize: patch.monoFontSize ?? 13,
      codeFontSize: 13,
      monoFontFamily: "",
      uiFontFamily: "",
      docFontMode: "ui",
      docFontFamily: "",
      stylePresetId: "pierre",
      theme: "system",
      language: "system",
    }));
    (
      window as unknown as {
        pier: { preferences: { update: typeof updateMock } };
      }
    ).pier = {
      preferences: { update: updateMock },
    };

    await useFontStore.getState().setMonoFontSize(18);
    expect(updateMock).toHaveBeenCalledWith({ monoFontSize: 18 });
    expect(useFontStore.getState().monoFontSize).toBe(18);
  });

  it("setCodeFontSize 调 IPC update 并同步 CSS 变量", async () => {
    const updateMock = vi.fn(async (patch: { codeFontSize?: number }) => ({
      monoFontSize: 13,
      codeFontSize: patch.codeFontSize ?? 13,
      monoFontFamily: "",
      uiFontFamily: "",
      docFontMode: "ui",
      docFontFamily: "",
      stylePresetId: "pierre",
      theme: "system",
      language: "system",
    }));
    (
      window as unknown as {
        pier: { preferences: { update: typeof updateMock } };
      }
    ).pier = {
      preferences: { update: updateMock },
    };

    await useFontStore.getState().setCodeFontSize(17);
    expect(updateMock).toHaveBeenCalledWith({ codeFontSize: 17 });
    expect(useFontStore.getState().codeFontSize).toBe(17);
    expect(
      document.documentElement.style.getPropertyValue("--pier-code-font-size")
    ).toBe("17px");
  });

  it("initFont 订阅 preferences.onChanged 并跨窗同步 codeFontSize", async () => {
    interface FontPrefsSlice {
      codeFontSize: number;
      docFontFamily: string;
      docFontMode: "ui" | "custom";
      monoFontFamily: string;
      monoFontSize: number;
      uiFontFamily: string;
    }
    let changed: ((snapshot: FontPrefsSlice) => void) | undefined;
    const read = vi.fn(
      async (): Promise<FontPrefsSlice> => ({
        uiFontFamily: "",
        monoFontFamily: "",
        docFontMode: "ui",
        docFontFamily: "",
        monoFontSize: 13,
        codeFontSize: 13,
      })
    );
    const onChanged = vi.fn((cb: (snapshot: FontPrefsSlice) => void) => {
      changed = cb;
      return vi.fn();
    });
    (
      window as unknown as {
        pier: {
          preferences: {
            onChanged: typeof onChanged;
            read: typeof read;
          };
        };
      }
    ).pier = {
      preferences: { onChanged, read },
    };

    await initFont();
    expect(onChanged).toHaveBeenCalled();
    expect(useFontStore.getState().codeFontSize).toBe(13);

    expect(changed).toBeTypeOf("function");
    changed?.({
      uiFontFamily: "",
      monoFontFamily: "",
      docFontMode: "ui",
      docFontFamily: "",
      monoFontSize: 13,
      codeFontSize: 18,
    });
    expect(useFontStore.getState().codeFontSize).toBe(18);
    expect(
      document.documentElement.style.getPropertyValue("--pier-code-font-size")
    ).toBe("18px");
  });
});

describe("computeDocumentFontFamily", () => {
  it("ui 模式跟随界面字体栈", () => {
    const ui = computeDocumentFontFamily("ui", "Inter", "");
    expect(ui.startsWith("Inter")).toBe(true);
    expect(ui).toContain("sans-serif");
  });

  it("custom 模式使用文档衬线回落链", () => {
    const doc = computeDocumentFontFamily("custom", "", "Noto Serif SC");
    expect(doc.startsWith('"Noto Serif SC"')).toBe(true);
    expect(doc).toContain("Songti SC");
    expect(doc.endsWith("serif")).toBe(true);
  });

  it("sanitize 拒绝 CSS 注入", () => {
    expect(sanitizeDocFontPrimary("foo; background: red")).toBe("");
    expect(sanitizeDocFontPrimary("Noto Serif SC")).toBe("Noto Serif SC");
  });
});

describe("computeMonoFontFamilyList", () => {
  it("空输入返回内置 fallback 链", () => {
    expect(computeMonoFontFamilyList("")).toEqual([
      "JetBrainsMono Nerd Font Mono",
      "PingFang SC",
      "Menlo",
    ]);
  });

  it("用户字体置于链首", () => {
    expect(computeMonoFontFamilyList("Fira Code")).toEqual([
      "Fira Code",
      "JetBrainsMono Nerd Font Mono",
      "PingFang SC",
      "Menlo",
    ]);
  });

  it("去掉引号与首尾空白", () => {
    expect(computeMonoFontFamilyList('  "My Mono"  ')[0]).toBe("My Mono");
  });

  it("大小写不敏感去重", () => {
    expect(computeMonoFontFamilyList("menlo")).toEqual([
      "menlo",
      "JetBrainsMono Nerd Font Mono",
      "PingFang SC",
    ]);
  });

  it("多个用户字体按逗号拆分且保序", () => {
    expect(computeMonoFontFamilyList("Fira Code, Cascadia Code")).toEqual([
      "Fira Code",
      "Cascadia Code",
      "JetBrainsMono Nerd Font Mono",
      "PingFang SC",
      "Menlo",
    ]);
  });

  it("剔除 CSS generic (monospace 等不进结果)", () => {
    const result = computeMonoFontFamilyList(
      "Fira Code, monospace, ui-monospace"
    );
    expect(result).not.toContain("monospace");
    expect(result).not.toContain("ui-monospace");
    expect(result).toEqual([
      "Fira Code",
      "JetBrainsMono Nerd Font Mono",
      "PingFang SC",
      "Menlo",
    ]);
  });
});

describe("computeMonoFontFamily", () => {
  it("空输入返回内置 fallback 链 (CJK 段走 var 引用)", () => {
    expect(computeMonoFontFamily("")).toBe(
      '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, var(--pier-cjk-font-family), Menlo, monospace'
    );
  });

  it("用户字体置于链首", () => {
    expect(computeMonoFontFamily("Fira Code")).toBe(
      '"Fira Code", "JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, var(--pier-cjk-font-family), Menlo, monospace'
    );
  });

  it("不含重复的普通版 JetBrains Mono (仅 Nerd Font 版)", () => {
    const result = computeMonoFontFamily("");
    expect(result).not.toContain('"JetBrains Mono"');
    expect(result).toContain('"JetBrainsMono Nerd Font Mono"');
  });

  it("CJK 兜底走 --pier-cjk-font-family 变量引用", () => {
    const result = computeMonoFontFamily("");
    expect(result).toContain("var(--pier-cjk-font-family)");
  });
});
