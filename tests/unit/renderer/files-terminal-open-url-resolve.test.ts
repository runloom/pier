import { describe, expect, it } from "vitest";
import { parseTerminalOpenUrl } from "../../../src/plugins/builtin/files/renderer/files-terminal-open-url-resolve.ts";

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
});
