import { detectDoubleClick } from "@plugins/builtin/files/renderer/files-double-click.ts";
import { describe, expect, it } from "vitest";

const WINDOW_MS = 400;

describe("detectDoubleClick", () => {
  it("returns isDouble=false on first click and tracks the path+time", () => {
    const result = detectDoubleClick("README.md", 1000, null, WINDOW_MS);
    expect(result.isDouble).toBe(false);
    expect(result.nextTrack).toEqual({ path: "README.md", timestamp: 1000 });
  });

  it("returns isDouble=true when the same path is clicked within the window", () => {
    const result = detectDoubleClick(
      "README.md",
      1200,
      { path: "README.md", timestamp: 1000 },
      WINDOW_MS
    );
    expect(result.isDouble).toBe(true);
    // 命中双击后清空 track,避免第三次点击又误判成新双击起点。
    expect(result.nextTrack).toBeNull();
  });

  it("returns isDouble=false when the same path is re-clicked outside the window", () => {
    const result = detectDoubleClick(
      "README.md",
      1500,
      { path: "README.md", timestamp: 1000 },
      WINDOW_MS
    );
    expect(result.isDouble).toBe(false);
    expect(result.nextTrack).toEqual({ path: "README.md", timestamp: 1500 });
  });

  it("returns isDouble=false when a different path is clicked within the window", () => {
    const result = detectDoubleClick(
      "src/a.ts",
      1050,
      { path: "src/b.ts", timestamp: 1000 },
      WINDOW_MS
    );
    expect(result.isDouble).toBe(false);
    expect(result.nextTrack).toEqual({ path: "src/a.ts", timestamp: 1050 });
  });

  it("does not treat exact window-boundary as a double click", () => {
    // now - last.timestamp === windowMs 属于窗口边界之外(<windowMs 是严格小于),
    // 边界一致的判定让配置改窗口时不会漏边界情况。
    const result = detectDoubleClick(
      "README.md",
      1400,
      { path: "README.md", timestamp: 1000 },
      WINDOW_MS
    );
    expect(result.isDouble).toBe(false);
    expect(result.nextTrack).toEqual({ path: "README.md", timestamp: 1400 });
  });
});
