import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cycleMarkdownFontScale,
  readMarkdownFontScale,
  readMarkdownMeasureMode,
  readMarkdownOpenMode,
  readMarkdownTocCollapsed,
  readMarkdownTocSide,
  useMarkdownPreviewPrefsStore,
  writeMarkdownFontScale,
  writeMarkdownMeasureMode,
  writeMarkdownOpenMode,
  writeMarkdownTocCollapsed,
  writeMarkdownTocSide,
} from "../../../src/plugins/builtin/files/renderer/markdown-preview-preferences.ts";

describe("markdown-preview-preferences", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    useMarkdownPreviewPrefsStore.setState({
      fontScale: 1,
      measureMode: "comfortable",
      tocCollapsed: false,
      tocSide: "right",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults open mode to source and persists preview", () => {
    expect(readMarkdownOpenMode()).toBe("source");
    writeMarkdownOpenMode("preview");
    expect(readMarkdownOpenMode()).toBe("preview");
  });

  it("cycles font scale within the supported steps", () => {
    expect(readMarkdownFontScale()).toBe(1);
    writeMarkdownFontScale(1.15);
    expect(readMarkdownFontScale()).toBe(1.15);
    expect(cycleMarkdownFontScale(1.15, "in")).toBe(1.35);
    expect(cycleMarkdownFontScale(2, "in")).toBe(2);
    expect(cycleMarkdownFontScale(0.75, "out")).toBe(0.75);
  });

  it("persists global reading mode, outline side, and collapse", () => {
    writeMarkdownMeasureMode("wide");
    writeMarkdownTocSide("left");
    writeMarkdownTocCollapsed(true);
    expect(readMarkdownMeasureMode()).toBe("wide");
    expect(readMarkdownTocSide()).toBe("left");
    expect(readMarkdownTocCollapsed()).toBe(true);
    expect(useMarkdownPreviewPrefsStore.getState().tocCollapsed).toBe(true);
    expect(localStorage.getItem("pier.files.markdown.tocCollapsed")).toBe(
      "true"
    );
  });
});
