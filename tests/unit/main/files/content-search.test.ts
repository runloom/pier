import { describe, expect, it } from "vitest";
import {
  parseRgMatchLine,
  utf8ByteOffsetToStringIndex,
} from "../../../../src/main/services/file-query/content-search.ts";
import {
  resolveSearchRuntime,
  searchRuntimeResourceRelativePath,
} from "../../../../src/main/services/file-query/search-runtime.ts";

describe("parseRgMatchLine", () => {
  it("maps absolute path under root to relative posix and byte ranges", () => {
    const line = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/repo/src/main/a.ts" },
        lines: { text: "hello 世界 world\n" },
        line_number: 3,
        absolute_offset: 40,
        submatches: [{ start: 6, end: 12 }],
      },
    });
    const items = parseRgMatchLine(line, "/repo");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      path: "src/main/a.ts",
      line: 3,
      matchByteStart: 46,
      matchByteEnd: 52,
    });
    // "hello " = 6 chars; 世界 starts at char 6
    expect(items[0]?.matchCharStart).toBe(6);
    expect(items[0]?.preview).toContain("世界");
  });

  it("emits one item per submatch", () => {
    const line = JSON.stringify({
      type: "match",
      data: {
        path: { text: "a.ts" },
        lines: { text: "foo foo\n" },
        line_number: 1,
        absolute_offset: 0,
        submatches: [
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ],
      },
    });
    const items = parseRgMatchLine(line, "/repo");
    expect(items).toHaveLength(2);
    expect(items[0]?.matchByteStart).toBe(0);
    expect(items[1]?.matchByteStart).toBe(4);
    expect(items[0]?.matchCharStart).toBe(0);
    expect(items[0]?.matchCharEnd).toBe(3);
    expect(items[1]?.matchCharStart).toBe(4);
    expect(items[1]?.matchCharEnd).toBe(7);
  });

  it("ignores non-match json lines", () => {
    expect(parseRgMatchLine('{"type":"begin"}', "/repo")).toEqual([]);
    expect(parseRgMatchLine("not-json", "/repo")).toEqual([]);
  });
});

describe("utf8ByteOffsetToStringIndex", () => {
  it("counts multi-byte characters as one string index", () => {
    const text = "ab世界cd";
    // "ab" = 2 bytes, "世" = 3 bytes → byte 5 is start of 界
    expect(utf8ByteOffsetToStringIndex(text, 0)).toBe(0);
    expect(utf8ByteOffsetToStringIndex(text, 2)).toBe(2);
    expect(utf8ByteOffsetToStringIndex(text, 5)).toBe(3);
    expect(utf8ByteOffsetToStringIndex(text, 100)).toBe(text.length);
  });
});

describe("resolveSearchRuntime", () => {
  it("returns inject path when executable", () => {
    // Use the current node binary as a stand-in executable for path checks.
    const node = process.execPath;
    const resolved = resolveSearchRuntime({
      injectPath: node,
      envPath: null,
      resourcesRoot: "/no/such/resources",
      projectRoot: "/no/such/project",
    });
    expect(resolved.kind).toBe("available");
    if (resolved.kind === "available") {
      expect(resolved.source).toBe("inject");
      expect(resolved.executablePath).toBe(node);
    }
  });

  it("is unavailable when no candidates exist", () => {
    const resolved = resolveSearchRuntime({
      injectPath: "/definitely/missing/rg-binary",
      envPath: null,
      resourcesRoots: ["/no/such/resources"],
      projectRoots: ["/no/such/project"],
      hostArch: "arm64",
    });
    expect(resolved.kind).toBe("unavailable");
    if (resolved.kind === "unavailable") {
      expect(resolved.arch).toBe("arm64");
      expect(resolved.tried.length).toBeGreaterThan(0);
      expect(searchRuntimeResourceRelativePath("arm64")).toBe(
        "search/arm64/rg"
      );
    }
  });

  it("finds repo resources via projectRoots", () => {
    const repo = process.cwd();
    const resolved = resolveSearchRuntime({
      envPath: null,
      injectPath: "/definitely/missing",
      projectRoots: [repo],
      resourcesRoots: [],
      hostArch: process.arch === "arm64" ? "arm64" : "x64",
    });
    // Dev workspaces with resources/search/<arch>/rg should resolve.
    if (resolved.kind === "available") {
      expect(resolved.executablePath).toContain("resources/search");
      expect(resolved.source).toBe("resources");
    }
  });
});
