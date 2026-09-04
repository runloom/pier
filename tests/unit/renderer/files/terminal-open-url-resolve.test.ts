import { afterEach, describe, expect, it, vi } from "vitest";
import type { PanelContext } from "../../../../src/shared/contracts/panel.ts";
import {
  listTerminalPathResolveRoots,
  normalizeTerminalPathText,
  parseTerminalOpenUrl,
  parseTerminalPathLocation,
  resolveTerminalLocalPathTargets,
} from "../../../../src/shared/terminal-local-path.ts";

function panelContext(partial: Partial<PanelContext> = {}): PanelContext {
  return {
    contextId: "c",
    cwd: "/repo/src",
    projectRootPath: "/repo",
    updatedAt: 1,
    ...partial,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizeTerminalPathText", () => {
  it("strips backticks quotes parens line numbers and trailing punct", () => {
    expect(normalizeTerminalPathText("`docs/a.md`")).toBe("docs/a.md");
    expect(normalizeTerminalPathText('"docs/a.md"')).toBe("docs/a.md");
    expect(normalizeTerminalPathText("(docs/a.md)")).toBe("docs/a.md");
    expect(normalizeTerminalPathText("docs/a.md:12:3")).toBe("docs/a.md");
    expect(normalizeTerminalPathText("docs/a.md:42")).toBe("docs/a.md");
    expect(normalizeTerminalPathText("docs/a.md.")).toBe("docs/a.md");
  });

  it("uses the first non-empty line", () => {
    expect(normalizeTerminalPathText("\n  docs/a.md\nnext")).toBe("docs/a.md");
  });
});

describe("parseTerminalPathLocation", () => {
  it("keeps path-only text without location", () => {
    expect(parseTerminalPathLocation("docs/a.md")).toEqual({
      path: "docs/a.md",
    });
  });

  it("extracts :line and :line:col", () => {
    expect(parseTerminalPathLocation("docs/a.md:12")).toEqual({
      line: 12,
      path: "docs/a.md",
    });
    expect(parseTerminalPathLocation("docs/a.md:12:3")).toEqual({
      column: 3,
      line: 12,
      path: "docs/a.md",
    });
  });

  it("strips wrappers before reading location", () => {
    expect(parseTerminalPathLocation("`docs/a.md:10:2`")).toEqual({
      column: 2,
      line: 10,
      path: "docs/a.md",
    });
  });
});

describe("listTerminalPathResolveRoots", () => {
  it("orders cwd then worktree then project then git and dedupes", () => {
    expect(
      listTerminalPathResolveRoots(
        panelContext({
          cwd: "/repo/src",
          worktreeRoot: "/repo",
          projectRootPath: "/repo",
          gitRoot: "/repo",
        })
      )
    ).toEqual(["/repo/src", "/repo"]);
  });

  it("returns empty without context", () => {
    expect(listTerminalPathResolveRoots(null)).toEqual([]);
  });
});

describe("resolveTerminalLocalPathTargets", () => {
  it("classifies https as remote", () => {
    expect(
      resolveTerminalLocalPathTargets("https://example.com/a", panelContext())
    ).toEqual({
      kind: "remote",
      url: "https://example.com/a",
    });
  });

  it("decodes file:// URLs", () => {
    expect(
      resolveTerminalLocalPathTargets(
        "file:///Users/x/My%20Docs/a.md",
        panelContext()
      )
    ).toEqual({
      kind: "local-paths",
      paths: ["/Users/x/My Docs/a.md"],
    });
  });

  it("keeps absolute paths as a single candidate", () => {
    expect(
      resolveTerminalLocalPathTargets("/repo/docs/a.md", panelContext())
    ).toEqual({
      kind: "local-paths",
      paths: ["/repo/docs/a.md"],
    });
  });

  it("builds multi-root candidates for relative paths", () => {
    expect(
      resolveTerminalLocalPathTargets(
        "docs/a.md",
        panelContext({
          cwd: "/repo/src",
          worktreeRoot: "/repo/wt",
          projectRootPath: "/repo",
          gitRoot: "/repo",
        })
      )
    ).toEqual({
      kind: "local-paths",
      paths: ["/repo/src/docs/a.md", "/repo/wt/docs/a.md", "/repo/docs/a.md"],
    });
  });

  it("resolves relative paths without cwd when project root exists", () => {
    expect(
      resolveTerminalLocalPathTargets(
        "docs/a.md",
        panelContext({ cwd: undefined, projectRootPath: "/repo" })
      )
    ).toEqual({
      kind: "local-paths",
      paths: ["/repo/docs/a.md"],
    });
  });

  it("does not guess relative paths without any root", () => {
    expect(resolveTerminalLocalPathTargets("docs/a.md", null)).toEqual({
      kind: "unresolved",
      reason: "relative-without-cwd",
    });
  });

  it("expands ~/ to the home directory instead of joining cwd", () => {
    vi.stubEnv("HOME", "/Users/alex");
    expect(
      resolveTerminalLocalPathTargets("~/notes.txt", panelContext())
    ).toEqual({
      kind: "local-paths",
      paths: ["/Users/alex/notes.txt"],
    });
  });

  it("normalizes backtick-wrapped selection text", () => {
    expect(
      resolveTerminalLocalPathTargets("`docs/a.md`", panelContext())
    ).toEqual({
      kind: "local-paths",
      paths: ["/repo/src/docs/a.md", "/repo/docs/a.md"],
    });
  });
});

describe("parseTerminalOpenUrl", () => {
  it("classifies https as remote", () => {
    expect(parseTerminalOpenUrl("https://example.com/a", "/repo")).toEqual({
      kind: "remote",
      url: "https://example.com/a",
    });
  });

  it("classifies mailto as remote", () => {
    expect(parseTerminalOpenUrl("mailto:a@b.com", null)).toEqual({
      kind: "remote",
      url: "mailto:a@b.com",
    });
  });
  it("keeps unsupported schemes inside the app", () => {
    expect(parseTerminalOpenUrl("local://notes.md", "/repo")).toEqual({
      kind: "unresolved",
      reason: "unsupported-scheme",
    });
    expect(parseTerminalOpenUrl("zed://file/repo/a.ts", "/repo")).toEqual({
      kind: "unresolved",
      reason: "unsupported-scheme",
    });
    expect(parseTerminalOpenUrl("vscode://file/x", "/repo")).toEqual({
      kind: "unresolved",
      reason: "unsupported-scheme",
    });
  });

  it("resolves pier://file with optional line and column", () => {
    expect(
      parseTerminalOpenUrl("pier://file/Users/a/repo/docs/a.md#L12C3", "/other")
    ).toEqual({
      column: 3,
      kind: "local-path",
      line: 12,
      path: "/Users/a/repo/docs/a.md",
    });
  });

  it("decodes file:// URLs", () => {
    expect(
      parseTerminalOpenUrl("file:///Users/x/My%20Docs/a.md", null)
    ).toEqual({
      kind: "local-path",
      path: "/Users/x/My Docs/a.md",
    });
  });

  it("keeps absolute paths", () => {
    expect(parseTerminalOpenUrl("/repo/docs/a.md", "/other")).toEqual({
      kind: "local-path",
      path: "/repo/docs/a.md",
    });
  });

  it("resolves relative paths against cwd", () => {
    expect(parseTerminalOpenUrl("docs/a.md", "/repo")).toEqual({
      kind: "local-path",
      path: "/repo/docs/a.md",
    });
    expect(parseTerminalOpenUrl("./docs/a.md", "/repo")).toEqual({
      kind: "local-path",
      path: "/repo/docs/a.md",
    });
    expect(parseTerminalOpenUrl("../x.md", "/repo/docs")).toEqual({
      kind: "local-path",
      path: "/repo/x.md",
    });
  });

  it("does not guess relative paths without cwd", () => {
    expect(parseTerminalOpenUrl("docs/a.md", null)).toEqual({
      kind: "unresolved",
      reason: "relative-without-cwd",
    });
  });

  it("expands ~/ before treating the path as relative", () => {
    vi.stubEnv("HOME", "/Users/alex");
    expect(parseTerminalOpenUrl("~/notes.txt", "/repo")).toEqual({
      kind: "local-path",
      path: "/Users/alex/notes.txt",
    });
  });

  it("rejects empty", () => {
    expect(parseTerminalOpenUrl("   ", "/repo")).toEqual({
      kind: "unresolved",
      reason: "invalid",
    });
  });

  it("strips wrappers when parsing", () => {
    expect(parseTerminalOpenUrl("`docs/a.md`", "/repo")).toEqual({
      kind: "local-path",
      path: "/repo/docs/a.md",
    });
  });

  it("preserves line and column from path suffixes", () => {
    expect(parseTerminalOpenUrl("docs/a.md:12:3", "/repo")).toEqual({
      column: 3,
      kind: "local-path",
      line: 12,
      path: "/repo/docs/a.md",
    });
  });
});
