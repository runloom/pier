import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFontStore } from "@/stores/font.store.ts";

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
