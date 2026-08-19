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

  it("formats Japanese and Korean ready copy", () => {
    expect(formatAppUpdateReadyCopy("1.0.0", "ja")).toEqual({
      body: "Pier 1.0.0 · 再起動してインストール",
      title: "更新の準備ができました",
    });
    expect(formatAppUpdateReadyCopy("1.0.0", "ko")).toEqual({
      body: "Pier 1.0.0 · 다시 시작해 설치",
      title: "업데이트 준비됨",
    });
  });
});
