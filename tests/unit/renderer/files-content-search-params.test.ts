import { describe, expect, it } from "vitest";
import {
  conditionsFromPanelParams,
  conditionsToPanelParams,
  parseContentSearchPanelParams,
} from "../../../src/plugins/builtin/files/renderer/files-content-search-params.ts";

describe("files content search params", () => {
  it("parses scopeDir and booleans", () => {
    const parsed = parseContentSearchPanelParams({
      root: "/repo",
      query: "TODO",
      caseSensitive: true,
      scopeDir: "src/main",
    });
    expect(parsed.scopeDir).toBe("src/main");
    expect(parsed.caseSensitive).toBe(true);
  });

  it("rejects scope with parent segments via conditionsFromPanelParams", () => {
    const conditions = conditionsFromPanelParams(
      { root: "/repo", scopeDir: "../escape" },
      null
    );
    // zod drops invalid optional fields → scopeDir undefined
    expect(conditions?.scopeDir).toBeUndefined();
  });

  it("round-trips conditions to panel params", () => {
    const conditions = conditionsFromPanelParams(
      {
        root: "/repo",
        query: "x",
        wholeWord: true,
        scopeDir: "src",
      },
      null
    );
    expect(conditions).not.toBeNull();
    if (!conditions) return;
    const params = conditionsToPanelParams(conditions);
    expect(params.root).toBe("/repo");
    expect(params.wholeWord).toBe(true);
    expect(params.scopeDir).toBe("src");
  });

  it("writes null scopeDir when cleared so sticky folder scope is removed", () => {
    const params = conditionsToPanelParams({
      applyExcludePatterns: true,
      applyGitIgnore: true,
      caseSensitive: false,
      include: "",
      query: "x",
      regexp: false,
      root: "/repo",
      scopeDir: undefined,
      wholeWord: false,
    });
    expect(params.scopeDir).toBeNull();
    expect(JSON.stringify(params)).toContain('"scopeDir":null');
    const again = conditionsFromPanelParams(params, null);
    expect(again?.scopeDir).toBeUndefined();
  });
});
