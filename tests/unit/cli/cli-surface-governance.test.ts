/**
 * CLI 用户手册治理：docs/cli.md 为使用说明；已实现区不得把未实现主路径写成默认可执行。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectCliDocsAvailableViolations,
  extractImplementedCommandsSection,
  extractMarkdownSection,
} from "./cli-docs-surface.ts";

const ROOT = process.cwd();

function readCliMd(): string {
  return readFileSync(join(ROOT, "docs/cli.md"), "utf8");
}

function readReadme(): string {
  return readFileSync(join(ROOT, "README.md"), "utf8");
}

describe("cli-docs-surface helpers", () => {
  it.each([
    ["pier agents catalog --json", null],
    ["pier agents list --json", null],
    ["pier agents invoke --json", "agents.unimplemented"],
    ["  pier plugins enable x", "plugins enable"],
    ["pier plugins disable foo", "plugins disable"],
    ["pier access request --json", "access"],
    ["pier status --json", null],
    ["pier open . --json", null],
    ["pier plugins list --json", null],
  ] as const)("detects available-surface line %s", (line, id) => {
    const violations = collectCliDocsAvailableViolations(line);
    if (id === null) {
      expect(violations).toEqual([]);
    } else {
      expect(violations).toContain(id);
    }
  });

  it("extractMarkdownSection slices until next h2", () => {
    const md = ["# T", "", "## A", "body-a", "", "## B", "body-b"].join("\n");
    expect(extractMarkdownSection(md, "A")).toBe("body-a");
    expect(extractMarkdownSection(md, "B")).toBe("body-b");
  });
});

describe("cli user manual governance", () => {
  it("docs/cli.md 是使用手册而非开发波次文档", () => {
    const md = readCliMd();
    expect(md).toMatch(/使用手册/u);
    expect(md).toMatch(/先启动 Pier/u);
    expect(md).not.toMatch(/交付波次|W0–W6|W0-W6|金标准命令面/u);
    expect(md).not.toMatch(
      /PIER_AGENT_CALLER_|agent-binding|effectKey|CapabilityAuthority/u
    );
    expect(md).toMatch(
      /不是.*多智能体编排权限|不负责.*权限|不负责.*委派|不负责.*权限签发/u
    );
  });

  it("已实现区不得把未实现 agents 主路径写成默认可执行示例", () => {
    const available = extractImplementedCommandsSection(readCliMd());
    expect(collectCliDocsAvailableViolations(available)).toEqual([]);
    expect(available).toMatch(/输出示例/u);
    expect(available).toMatch(/plugins list/u);
    expect(available).toMatch(/agents catalog/u);
  });

  it("暂未实现章节写全 agents / 终端 / 消息 / access 等并含预期输出", () => {
    const md = readCliMd();
    expect(md).toMatch(/# 第二部分：暂未实现命令（完整说明）/u);
    expect(md).toMatch(/命令总表/u);
    for (const heading of [
      "### `agents self`",
      "### `agents invoke`",
      "### `agents start`",
      "### `agents turn`",
      "### `agents screen`",
      "### `agents wait`",
      "### `agents watch`",
      "### `agents focus`",
      "### `agents interrupt`",
      "### `agents terminate`",
      "### `terminal list`",
      "### `terminal send`",
      "### `terminal key`",
      "### `terminal interrupt`",
      "### `terminal terminate`",
      "### `terminal wait`",
      "### `terminal watch`",
      "### `snapshot`",
      "### `watch`",
      "### `activity snapshot`",
      "### `notifications list`",
      "### `access request`",
    ]) {
      expect(md, `missing ${heading}`).toContain(heading);
    }
    expect(md).toMatch(/状态：暂未实现/u);
    expect(md).toMatch(/预期输出示例/u);
  });

  it("README CLI 入口指向 docs/cli.md 且为使用说明定位", () => {
    const readme = readReadme();
    expect(readme).toMatch(/docs\/cli\.md/u);
  });
});
