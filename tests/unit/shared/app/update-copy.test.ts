import { formatAppUpdateReadyCopy } from "@shared/app-update-copy.ts";
import { describe, expect, it } from "vitest";

describe("formatAppUpdateReadyCopy", () => {
  it("formats English ready copy", () => {
    expect(formatAppUpdateReadyCopy("1.0.0", "en")).toEqual({
      body: "Pier 1.0.0 · restart to finish installing",
      title: "Update ready",
    });
  });

  it("formats Chinese ready copy", () => {
    expect(formatAppUpdateReadyCopy("1.0.0", "zh-CN")).toEqual({
      body: "Pier 1.0.0 · 重启后自动安装",
      title: "更新已就绪",
    });
  });
});
