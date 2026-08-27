import {
  HTML_OPEN_MODE_KEY,
  readHtmlOpenMode,
  writeHtmlOpenMode,
} from "@plugins/builtin/files/renderer/preview/html-open-mode.ts";
import { beforeEach, describe, expect, it } from "vitest";

describe("html open mode preference", () => {
  beforeEach(() => {
    window.localStorage.removeItem(HTML_OPEN_MODE_KEY);
  });

  it("defaults to source and round-trips writes", () => {
    expect(readHtmlOpenMode()).toBe("source");

    writeHtmlOpenMode("preview");
    expect(readHtmlOpenMode()).toBe("preview");

    writeHtmlOpenMode("source");
    expect(readHtmlOpenMode()).toBe("source");
  });

  it("falls back to source for missing or invalid values", () => {
    window.localStorage.setItem(HTML_OPEN_MODE_KEY, "side-by-side");
    expect(readHtmlOpenMode()).toBe("source");

    window.localStorage.setItem(HTML_OPEN_MODE_KEY, "");
    expect(readHtmlOpenMode()).toBe("source");
  });
});
