import { describe, expect, it } from "vitest";
import {
  listTerminalPathResolveRoots,
  normalizeTerminalPathText,
  parseTerminalOpenUrl,
  resolveTerminalLocalPathTargets,
} from "../../../src/plugins/builtin/files/renderer/files-terminal-open-url-resolve.ts";
import type { PanelContext } from "../../../src/shared/contracts/panel.ts";

function panelContext(partial: Partial<PanelContext> = {}): PanelContext {
  return {
    contextId: "c",
    cwd: "/repo/src",
    projectRootPath: "/repo",
    updatedAt: 1,
    ...partial,
  };
}

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
});
