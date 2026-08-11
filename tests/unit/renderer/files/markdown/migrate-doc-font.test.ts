import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateLegacyMarkdownReadingFontToDocumentFont } from "../../../../../src/plugins/builtin/files/renderer/markdown/migrate-doc-font.ts";
import {
  FILES_MARKDOWN_READING_FONT_FAMILY_LEGACY_PRIMARY,
  FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY,
  FILES_MARKDOWN_READING_FONT_SETTING_KEY,
} from "../../../../../src/plugins/builtin/files/settings.ts";

describe("migrateLegacyMarkdownReadingFontToDocumentFont", () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "pier");
  });

  it("promotes legacy custom markdown font when Appearance is default", async () => {
    const update = vi.fn(async () => ({}));
    const read = vi.fn(async () => ({
      docFontMode: "ui",
      docFontFamily: "",
    }));
    Object.assign(globalThis, {
      pier: { preferences: { read, update } },
    });

    migrateLegacyMarkdownReadingFontToDocumentFont({
      get: <T>(key: string): T => {
        if (key === FILES_MARKDOWN_READING_FONT_SETTING_KEY) {
          return "custom" as T;
        }
        if (key === FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY) {
          return "Noto Serif SC" as T;
        }
        return undefined as T;
      },
    });

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        docFontMode: "custom",
        docFontFamily: "Noto Serif SC",
      });
    });
    // First check + re-check before write.
    expect(read).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("pier.fonts.docFontMigratedFromMarkdown")).toBe(
      "1"
    );
  });

  it("does not overwrite an existing document font preference", async () => {
    const update = vi.fn(async () => ({}));
    const read = vi.fn(async () => ({
      docFontMode: "custom",
      docFontFamily: "Georgia",
    }));
    Object.assign(globalThis, {
      pier: { preferences: { read, update } },
    });

    migrateLegacyMarkdownReadingFontToDocumentFont({
      get: <T>(key: string): T =>
        (key === FILES_MARKDOWN_READING_FONT_SETTING_KEY
          ? "custom"
          : undefined) as T,
    });

    await vi.waitFor(() => {
      expect(
        localStorage.getItem("pier.fonts.docFontMigratedFromMarkdown")
      ).toBe("1");
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("re-check skips write when Appearance changes between reads", async () => {
    const update = vi.fn(async () => ({}));
    let reads = 0;
    const read = vi.fn(async () => {
      reads += 1;
      if (reads === 1) {
        return { docFontMode: "ui", docFontFamily: "" };
      }
      return { docFontMode: "custom", docFontFamily: "Georgia" };
    });
    Object.assign(globalThis, {
      pier: { preferences: { read, update } },
    });

    migrateLegacyMarkdownReadingFontToDocumentFont({
      get: <T>(key: string): T =>
        (key === FILES_MARKDOWN_READING_FONT_SETTING_KEY
          ? "custom"
          : undefined) as T,
    });

    await vi.waitFor(() => {
      expect(
        localStorage.getItem("pier.fonts.docFontMigratedFromMarkdown")
      ).toBe("1");
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it("uses legacy primary when custom family is empty", async () => {
    const update = vi.fn(async () => ({}));
    const read = vi.fn(async () => ({
      docFontMode: "ui",
      docFontFamily: "",
    }));
    Object.assign(globalThis, {
      pier: { preferences: { read, update } },
    });

    migrateLegacyMarkdownReadingFontToDocumentFont({
      get: <T>(key: string): T => {
        if (key === FILES_MARKDOWN_READING_FONT_SETTING_KEY) {
          return "custom" as T;
        }
        if (key === FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY) {
          return "" as T;
        }
        return undefined as T;
      },
    });

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        docFontMode: "custom",
        docFontFamily: FILES_MARKDOWN_READING_FONT_FAMILY_LEGACY_PRIMARY,
      });
    });
  });
});
