import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readMarkdownOpenMode } from "@plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import {
  defaultModeForSource,
  persistPreviewOpenMode,
} from "@plugins/builtin/files/renderer/panel/use-transfer-view.ts";
import {
  HTML_OPEN_MODE_KEY,
  readHtmlOpenMode,
  writeHtmlOpenMode,
} from "@plugins/builtin/files/renderer/preview/html-open-mode.ts";
import {
  readSvgOpenMode,
  SVG_OPEN_MODE_KEY,
  writeSvgOpenMode,
} from "@plugins/builtin/files/renderer/preview/svg-open-mode.ts";
import { beforeEach, describe, expect, it } from "vitest";

const diskSource = {
  kind: "disk" as const,
  path: "index.html",
  root: "/workspace/pier",
};
const svgDiskSource = {
  kind: "disk" as const,
  path: "icon.svg",
  root: "/workspace/pier",
};

describe("defaultModeForSource", () => {
  beforeEach(() => {
    window.localStorage.removeItem(HTML_OPEN_MODE_KEY);
    window.localStorage.removeItem(SVG_OPEN_MODE_KEY);
    window.localStorage.removeItem("pier.files.markdown.openMode");
  });

  it("defaults html documents to source without a stored preference", () => {
    expect(defaultModeForSource(diskSource, "html")).toBe("source");
  });

  it("honors the stored html open mode preference", () => {
    writeHtmlOpenMode("preview");
    expect(defaultModeForSource(diskSource, "html")).toBe("preview");
  });

  it("keeps markdown behavior unchanged and ignores untitled sources", () => {
    expect(defaultModeForSource(diskSource, "markdown")).toBe("source");
    window.localStorage.setItem("pier.files.markdown.openMode", "preview");
    expect(defaultModeForSource(diskSource, "markdown")).toBe("preview");
    // html 偏好不泄漏到 markdown,反之亦然。
    expect(defaultModeForSource(diskSource, "html")).toBe("source");

    expect(
      defaultModeForSource(
        { id: "untitled-1", kind: "untitled", name: "Untitled" },
        "html"
      )
    ).toBe("source");
    expect(defaultModeForSource(null, "html")).toBe("source");
  });

  it("does not apply html preview preference to untitled documents", () => {
    writeHtmlOpenMode("preview");
    expect(
      defaultModeForSource(
        { id: "untitled-1", kind: "untitled", name: "Untitled" },
        "html"
      )
    ).toBe("source");
    expect(defaultModeForSource(null, "html")).toBe("source");
    expect(defaultModeForSource(diskSource, "html")).toBe("preview");
  });

  it("does not apply svg preview preference to untitled documents", () => {
    writeSvgOpenMode("preview");
    expect(
      defaultModeForSource(
        { id: "untitled-1", kind: "untitled", name: "Untitled" },
        "svg"
      )
    ).toBe("source");
    expect(defaultModeForSource(svgDiskSource, "svg")).toBe("preview");
  });

  it("keeps group-view html and svg open-mode on the disk-gated helper", async () => {
    const source = await readFile(
      join(
        process.cwd(),
        "src/plugins/builtin/files/renderer/panel/group-view.tsx"
      ),
      "utf8"
    );
    expect(source).toContain("defaultModeForSource(");
    expect(source).not.toMatch(
      /language === "html"\) return readHtmlOpenMode\(\)/u
    );
    expect(source).not.toMatch(
      /language === "svg"\) return readSvgOpenMode\(\)/u
    );
  });
});

describe("persistPreviewOpenMode", () => {
  beforeEach(() => {
    window.localStorage.removeItem(HTML_OPEN_MODE_KEY);
    window.localStorage.removeItem(SVG_OPEN_MODE_KEY);
    window.localStorage.removeItem("pier.files.markdown.openMode");
  });

  it("writes html preview preference without leaking into markdown", () => {
    persistPreviewOpenMode("html", "preview");
    expect(readHtmlOpenMode()).toBe("preview");
    expect(readMarkdownOpenMode()).toBe("source");
  });

  it("writes markdown preview preference without leaking into html", () => {
    persistPreviewOpenMode("markdown", "preview");
    expect(readMarkdownOpenMode()).toBe("preview");
    expect(readHtmlOpenMode()).toBe("source");
  });

  it("does not persist diff mode", () => {
    persistPreviewOpenMode("html", "diff");
    persistPreviewOpenMode("markdown", "diff");
    expect(readHtmlOpenMode()).toBe("source");
    expect(readMarkdownOpenMode()).toBe("source");
  });

  it("writes svg preview preference without leaking into html", () => {
    persistPreviewOpenMode("svg", "preview");
    expect(readSvgOpenMode()).toBe("preview");
    expect(readHtmlOpenMode()).toBe("source");
  });
});
