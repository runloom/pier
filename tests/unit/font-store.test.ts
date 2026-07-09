import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeMonoFontFamily,
  computeMonoFontFamilyList,
  useFontStore,
} from "@/stores/font.store.ts";

describe("font.store — monoFontSize", () => {
  beforeEach(() => {
    useFontStore.setState({
      uiFontFamily: "",
      monoFontFamily: "",
      monoFontSize: 13,
    });
  });

  it("默认 monoFontSize 是 13", () => {
    expect(useFontStore.getState().monoFontSize).toBe(13);
  });

  it("_hydrate 同时设置 family 和 size", () => {
    useFontStore.getState()._hydrate({
      uiFontFamily: "",
      monoFontFamily: "Fira Code",
      monoFontSize: 16,
    });
    const s = useFontStore.getState();
    expect(s.monoFontFamily).toBe("Fira Code");
    expect(s.monoFontSize).toBe(16);
  });

  it("setMonoFontSize 调 IPC update 并写回 state", async () => {
    const updateMock = vi.fn(async (patch: { monoFontSize?: number }) => ({
      monoFontSize: patch.monoFontSize ?? 13,
      monoFontFamily: "",
      uiFontFamily: "",
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
});

describe("computeMonoFontFamilyList", () => {
  it("空输入返回内置 fallback 链", () => {
    expect(computeMonoFontFamilyList("")).toEqual([
      "JetBrainsMono Nerd Font Mono",
      "HarmonyOS Sans SC",
      "Menlo",
    ]);
  });

  it("用户字体置于链首", () => {
    expect(computeMonoFontFamilyList("Fira Code")).toEqual([
      "Fira Code",
      "JetBrainsMono Nerd Font Mono",
      "HarmonyOS Sans SC",
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
      "HarmonyOS Sans SC",
    ]);
  });

  it("多个用户字体按逗号拆分且保序", () => {
    expect(computeMonoFontFamilyList("Fira Code, Cascadia Code")).toEqual([
      "Fira Code",
      "Cascadia Code",
      "JetBrainsMono Nerd Font Mono",
      "HarmonyOS Sans SC",
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
      "HarmonyOS Sans SC",
      "Menlo",
    ]);
  });
});

describe("computeMonoFontFamily", () => {
  it("空输入返回内置 fallback 链 (含 CJK 兜底)", () => {
    expect(computeMonoFontFamily("")).toBe(
      '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, "HarmonyOS Sans SC", "PingFang SC", Menlo, monospace'
    );
  });

  it("用户字体置于链首", () => {
    expect(computeMonoFontFamily("Fira Code")).toBe(
      '"Fira Code", "JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, "HarmonyOS Sans SC", "PingFang SC", Menlo, monospace'
    );
  });

  it("不含重复的普通版 JetBrains Mono (仅 Nerd Font 版)", () => {
    const result = computeMonoFontFamily("");
    expect(result).not.toContain('"JetBrains Mono"');
    expect(result).toContain('"JetBrainsMono Nerd Font Mono"');
  });

  it("CJK 兜底存在 (HarmonyOS Sans SC + PingFang SC)", () => {
    const result = computeMonoFontFamily("");
    expect(result).toContain('"HarmonyOS Sans SC"');
    expect(result).toContain('"PingFang SC"');
  });
});
