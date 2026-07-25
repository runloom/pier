import { describe, expect, it } from "vitest";
import {
  joinUnderRoot,
  splitAbsoluteForReveal,
} from "../../../src/renderer/lib/files/shell-path-actions.ts";

describe("shell-path-actions", () => {
  it("splits absolute POSIX paths for files.reveal", () => {
    expect(splitAbsoluteForReveal("/Users/me/.cursor/mcp.json")).toEqual({
      path: "mcp.json",
      root: "/Users/me/.cursor",
    });
  });

  it("splits absolute Windows paths for files.reveal", () => {
    expect(splitAbsoluteForReveal("C:\\Users\\me\\.cursor\\mcp.json")).toEqual({
      path: "mcp.json",
      root: "C:\\Users\\me\\.cursor",
    });
  });

  it("joins root-relative paths without double separators", () => {
    expect(joinUnderRoot("/proj/", ".cursor/rules")).toBe(
      "/proj/.cursor/rules"
    );
    expect(joinUnderRoot("/proj", "/.cursor/rules")).toBe(
      "/proj/.cursor/rules"
    );
  });
});
