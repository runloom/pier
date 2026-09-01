import { describe, expect, it } from "vitest";
import {
  foldHomePath,
  formatMemoryDegradedDetails,
} from "../../../src/plugins/builtin/memory/renderer/format-degraded-details.ts";

const t = (
  key: string,
  values?: Record<string, number | string>,
  fallback?: string
) => {
  if (key === "degraded.othersConnected" && values?.count != null) {
    return `Other agents connected: ${values.count}`;
  }
  if (key === "degraded.alreadyDefined") {
    return "remove the existing entry";
  }
  return fallback ?? key;
};

describe("formatMemoryDegradedDetails", () => {
  it("folds home and lists failures before a connected count", () => {
    const body = formatMemoryDegradedDetails(
      {
        storePath: "/Users/xyz/.pier/memory/abc/memory.jsonl",
        storePathDisplay: "~/.pier/memory/abc/memory.jsonl",
        targets: [
          {
            configPath: "/Users/xyz/.claude.json",
            consumers: ["claude", "cursor"],
            outcome: "written",
          },
          {
            configPath: "/Users/xyz/.grok/config.toml",
            consumers: ["grok"],
            detail: "pier-memory already defined in TOML MCP config",
            outcome: "failed",
          },
        ],
      },
      t
    );
    expect(body).toContain("~/.grok/config.toml");
    expect(body).toContain("remove the existing entry");
    expect(body).toContain("Other agents connected: 2");
    expect(body).not.toContain("written");
    expect(body).not.toContain("/Users/xyz/.claude.json");
  });
});

describe("foldHomePath", () => {
  it("leaves paths outside the home prefix unchanged", () => {
    expect(
      foldHomePath(
        "/opt/grok/config.toml",
        "/Users/xyz/.pier/memory/abc/memory.jsonl",
        "~/.pier/memory/abc/memory.jsonl"
      )
    ).toBe("/opt/grok/config.toml");
  });
});
