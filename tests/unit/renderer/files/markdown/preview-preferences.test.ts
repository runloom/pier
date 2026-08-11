import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindMarkdownSettingsFromConfiguration,
  cycleMarkdownFontScale,
  readMarkdownBlockHeightLimit,
  readMarkdownFontScale,
  readMarkdownMeasureMode,
  readMarkdownOpenMode,
  readMarkdownReadingAppearance,
  useMarkdownPreviewPrefsStore,
  writeMarkdownFontScale,
  writeMarkdownMeasureMode,
  writeMarkdownOpenMode,
  writeMarkdownReadingAppearance,
} from "../../../../../src/plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import { FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY } from "../../../../../src/plugins/builtin/files/settings.ts";

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

  it("mirrors Files plugin configuration for block height only", () => {
    const values = new Map<string, unknown>([
      [FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY, "capped"],
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

    values.set(FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY, "none");
    for (const listener of listeners) {
      listener({
        affectsConfiguration: (key) =>
          key === FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY,
      });
    }
    expect(readMarkdownBlockHeightLimit()).toBe("none");
    dispose();
  });
});
