import { describe, expect, it } from "vitest";
import {
  normalizeEditorDefaultLanguage,
  normalizeEditorTabSize,
  readFilesEditorDefaultEol,
  readFilesEditorPrefs,
  resolveFilesEditorLanguage,
} from "../../../src/plugins/builtin/files/renderer/files-editor-prefs.ts";
import {
  FILES_EDITOR_DEFAULT_EOL_SETTING_KEY,
  FILES_EDITOR_DEFAULT_LANGUAGE_SETTING_KEY,
  FILES_EDITOR_LSP_ENABLED_SETTING_KEY,
  FILES_EDITOR_TAB_SIZE_SETTING_KEY,
  FILES_EDITOR_WORD_WRAP_SETTING_KEY,
} from "../../../src/plugins/builtin/files/settings.ts";

function configurationFrom(values: Record<string, unknown>): {
  get: <T>(key: string) => T;
} {
  return {
    get: <T>(key: string) => values[key] as T,
  };
}

describe("normalizeEditorTabSize", () => {
  it("accepts only the CodeMirror-supported values 2/4/8", () => {
    expect(normalizeEditorTabSize(2)).toBe(2);
    expect(normalizeEditorTabSize(4)).toBe(4);
    expect(normalizeEditorTabSize(8)).toBe(8);
    expect(normalizeEditorTabSize("2")).toBe(2);
    expect(normalizeEditorTabSize("4")).toBe(4);
    expect(normalizeEditorTabSize("8")).toBe(8);
    expect(normalizeEditorTabSize(0)).toBe(2);
    expect(normalizeEditorTabSize(2.5)).toBe(2);
    expect(normalizeEditorTabSize(3)).toBe(2);
    expect(normalizeEditorTabSize(100)).toBe(2);
    expect(normalizeEditorTabSize("nope")).toBe(2);
  });
});

describe("readFilesEditorPrefs", () => {
  it("reads wrap/tab/lsp flags from configuration", () => {
    const prefs = readFilesEditorPrefs({
      configuration: configurationFrom({
        [FILES_EDITOR_DEFAULT_LANGUAGE_SETTING_KEY]: "typescript",
        [FILES_EDITOR_WORD_WRAP_SETTING_KEY]: true,
        [FILES_EDITOR_TAB_SIZE_SETTING_KEY]: "4",
        [FILES_EDITOR_LSP_ENABLED_SETTING_KEY]: false,
      }),
    });
    expect(prefs).toEqual({
      defaultLanguage: "typescript",
      lspEnabled: false,
      tabSize: 4,
      wordWrap: true,
    });
  });

  it("defaults wrap off, tab 2, lsp on", () => {
    const prefs = readFilesEditorPrefs({
      configuration: configurationFrom({}),
    });
    expect(prefs).toEqual({
      defaultLanguage: null,
      lspEnabled: true,
      tabSize: 2,
      wordWrap: false,
    });
  });
});

describe("normalizeEditorDefaultLanguage", () => {
  it("accepts supported languages and maps auto or unknown values to null", () => {
    expect(normalizeEditorDefaultLanguage("python")).toBe("python");
    expect(normalizeEditorDefaultLanguage("auto")).toBeNull();
    expect(normalizeEditorDefaultLanguage("unknown")).toBeNull();
  });
});

describe("resolveFilesEditorLanguage", () => {
  it("uses the default only when path detection falls back to text", () => {
    expect(resolveFilesEditorLanguage("text", "typescript")).toBe("typescript");
    expect(resolveFilesEditorLanguage("json", "typescript")).toBe("json");
    expect(resolveFilesEditorLanguage("text", null)).toBe("text");
  });
});

describe("readFilesEditorDefaultEol", () => {
  it("maps the browser platform to the Auto EOL", () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Win32",
    });

    try {
      expect(
        readFilesEditorDefaultEol({
          configuration: configurationFrom({
            [FILES_EDITOR_DEFAULT_EOL_SETTING_KEY]: "auto",
          }),
        })
      ).toBe("crlf");
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: "Linux x86_64",
      });
      expect(
        readFilesEditorDefaultEol({
          configuration: configurationFrom({
            [FILES_EDITOR_DEFAULT_EOL_SETTING_KEY]: "auto",
          }),
        })
      ).toBe("lf");
    } finally {
      if (descriptor) {
        Object.defineProperty(navigator, "platform", descriptor);
      } else {
        Reflect.deleteProperty(navigator, "platform");
      }
    }
  });

  it("accepts explicit EOL and defaults unknown configuration to LF", () => {
    expect(
      readFilesEditorDefaultEol({
        configuration: configurationFrom({
          [FILES_EDITOR_DEFAULT_EOL_SETTING_KEY]: "crlf",
        }),
      })
    ).toBe("crlf");
    expect(
      readFilesEditorDefaultEol({
        configuration: configurationFrom({
          [FILES_EDITOR_DEFAULT_EOL_SETTING_KEY]: "invalid",
        }),
      })
    ).toBe("lf");
  });
});
