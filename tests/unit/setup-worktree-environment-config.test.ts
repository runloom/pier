import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pier 工作树环境配置", () => {
  it("只通过 setup:worktree 按需构建 native，不再重复强制构建", async () => {
    const raw = await readFile(
      resolve(process.cwd(), ".pier/environment.json"),
      "utf8"
    );
    const config = JSON.parse(raw) as { setupCommand?: string };

    expect(config.setupCommand).toBe("pnpm setup:worktree");
  });
});
