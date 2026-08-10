import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindMarkdownSettingsFromConfiguration,
  cycleMarkdownFontScale,
  readMarkdownBlockHeightLimit,
  readMarkdownFontScale,
  readMarkdownMeasureMode,
  readMarkdownOpenMode,
  readMarkdownReadingAppearance,
  readMarkdownReadingFont,
  readMarkdownReadingFontFamily,
  useMarkdownPreviewPrefsStore,
  writeMarkdownFontScale,
  writeMarkdownMeasureMode,
  writeMarkdownOpenMode,
  writeMarkdownReadingAppearance,
} from "../../../../../src/plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import {
  computeMarkdownReadingFontFamily,
  sanitizeReadingFontPrimary,
} from "../../../../../src/plugins/builtin/files/renderer/markdown/reading-font.ts";
import {
  FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY,
  FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT,
  FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY,
  FILES_MARKDOWN_READING_FONT_SETTING_KEY,
} from "../../../../../src/plugins/builtin/files/settings.ts";

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
      blockHeightLimit: "none",
      fontScale: 1,
      measureMode: "comfortable",
      readingAppearance: "auto",
      readingFont: "ui",
      readingFontFamily: FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT,
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

  it("persists global reading mode", () => {
    writeMarkdownMeasureMode("wide");
    expect(readMarkdownMeasureMode()).toBe("wide");
    expect(localStorage.getItem("pier.files.markdown.measureMode")).toBe(
      "wide"
    );
  });

  it("defaults reading appearance to auto and persists light/dark", () => {
    expect(readMarkdownReadingAppearance()).toBe("auto");
    writeMarkdownReadingAppearance("light");
    expect(readMarkdownReadingAppearance()).toBe("light");
    expect(localStorage.getItem("pier.files.markdown.readingAppearance")).toBe(
      "light"
    );
    writeMarkdownReadingAppearance("dark");
    expect(readMarkdownReadingAppearance()).toBe("dark");
    writeMarkdownReadingAppearance("auto");
    expect(readMarkdownReadingAppearance()).toBe("auto");
  });

  it("sanitizes custom primary font names", () => {
    expect(sanitizeReadingFontPrimary("Noto Serif SC")).toBe("Noto Serif SC");
    expect(sanitizeReadingFontPrimary("foo; background: red")).toBe(
      FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT
    );
    expect(sanitizeReadingFontPrimary("")).toBe("");
  });

  it("builds a document font stack from primary + fallbacks", () => {
    const stack = computeMarkdownReadingFontFamily("Noto Serif SC");
    expect(stack.startsWith('"Noto Serif SC"')).toBe(true);
    expect(stack).toContain("Songti SC");
    expect(stack.endsWith("serif")).toBe(true);
  });

  it("mirrors Files plugin configuration for markdown preview settings", () => {
    const values = new Map<string, unknown>([
      [FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY, "capped"],
      [FILES_MARKDOWN_READING_FONT_SETTING_KEY, "custom"],
      [FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY, "Noto Serif SC"],
    ]);
    const listeners = new Set<
      (event: { affectsConfiguration: (key: string) => boolean }) => void
    >();
    const dispose = bindMarkdownSettingsFromConfiguration({
      get: <T>(key: string) => values.get(key) as T,
      onDidChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    });
    expect(readMarkdownBlockHeightLimit()).toBe("capped");
    expect(readMarkdownReadingFont()).toBe("custom");
    expect(readMarkdownReadingFontFamily()).toBe("Noto Serif SC");

    values.set(FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY, "none");
    values.set(FILES_MARKDOWN_READING_FONT_SETTING_KEY, "ui");
    values.set(
      FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY,
      FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT
    );
    for (const listener of listeners) {
      listener({
        affectsConfiguration: (key) =>
          key === FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY ||
          key === FILES_MARKDOWN_READING_FONT_SETTING_KEY ||
          key === FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY,
      });
    }
    expect(readMarkdownBlockHeightLimit()).toBe("none");
    expect(readMarkdownReadingFont()).toBe("ui");
    expect(readMarkdownReadingFontFamily()).toBe(
      FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT
    );
    dispose();
  });

  it("migrates legacy document font mode to custom", () => {
    const dispose = bindMarkdownSettingsFromConfiguration({
      get: <T>(key: string) =>
        (key === FILES_MARKDOWN_READING_FONT_SETTING_KEY
          ? "document"
          : undefined) as T,
      onDidChange: () => () => undefined,
    });
    expect(readMarkdownReadingFont()).toBe("custom");
    dispose();
  });
});
