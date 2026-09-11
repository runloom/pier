import {
  isMarkdownPreviewScrollSurfaceVisible,
  parseMarkdownScrollMemory,
  recallScrollPosition,
  rememberScrollPosition,
  shouldCaptureMarkdownPreviewScroll,
} from "@plugins/builtin/files/renderer/markdown/scroll-memory.ts";
import { beforeEach, describe, expect, it } from "vitest";

describe("scroll memory", () => {
  beforeEach(() => localStorage.clear());

  it("recalls v2 offset while ignoring source text edits", () => {
    rememberScrollPosition({ sourcePath: "/m.md", offset: 480 });
    expect(recallScrollPosition("/m.md")).toEqual({
      align: "start",
      offset: 480,
    });
    rememberScrollPosition({
      blockProgress: 0.4,
      offset: 480,
      sourcePath: "/m.md",
    });
    expect(recallScrollPosition("/m.md")).toEqual({
      align: "start",
      blockProgress: 0.4,
      offset: 480,
    });
  });

  it("ignores v1 pixel payloads and offset 0", () => {
    localStorage.setItem(
      "pier.files.markdown.scroll:/m.md",
      JSON.stringify({ h: "123", top: 480 })
    );
    expect(recallScrollPosition("/m.md")).toBeNull();
    rememberScrollPosition({ offset: 0, sourcePath: "/z.md" });
    expect(recallScrollPosition("/z.md")).toBeNull();
    expect(parseMarkdownScrollMemory({ h: "1", top: 12 })).toBeNull();
    expect(parseMarkdownScrollMemory({ offset: 12, v: 1 })).toBeNull();
    expect(parseMarkdownScrollMemory({ offset: 0, v: 2 })).toBeNull();
  });

  it("does not capture when the preview is hidden or already at the top", () => {
    const root = document.createElement("div");
    Object.defineProperty(root, "scrollTop", {
      configurable: true,
      value: 120,
      writable: true,
    });
    document.body.append(root);
    expect(isMarkdownPreviewScrollSurfaceVisible(root)).toBe(true);
    expect(shouldCaptureMarkdownPreviewScroll(root)).toBe(true);

    Object.defineProperty(root, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    expect(shouldCaptureMarkdownPreviewScroll(root)).toBe(false);

    Object.defineProperty(root, "scrollTop", {
      configurable: true,
      value: 120,
      writable: true,
    });
    const host = document.createElement("div");
    host.style.display = "none";
    document.body.append(host);
    host.append(root);
    expect(isMarkdownPreviewScrollSurfaceVisible(root)).toBe(false);
    expect(shouldCaptureMarkdownPreviewScroll(root)).toBe(false);
    host.remove();
  });
});
