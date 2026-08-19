/**
 * CLI 用户手册治理：以 pier-cli-user-manual Canvas data.json 为唯一真源；
 * shipped 表面不得把规划/无写权主路径写成默认可执行。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLI_USER_MANUAL_DATA_PATH,
  collectCliDocsAvailableViolations,
  collectCliManualShippedSurfaceText,
  collectInventoryMismatches,
  listCliManualCommands,
  readCliUserManualData,
} from "./cli-docs-surface.ts";

const ROOT = process.cwd();

function readFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("cli-docs-surface helpers", () => {
  it.each([
    ["pier agents catalog --json", null],
    ["pier agents list --json", null],
    ["pier agents invoke --json", "agents.unimplemented"],
    ["pier agents start --agent codex --json", null],
    ["pier agents watch --json", null],
    ["  pier plugins enable x", "plugins enable"],
    ["pier plugins disable foo", "plugins disable"],
    ["pier access request --json", "access"],
    ["pier notifications list --json", null],
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
});

describe("cli user manual governance (canvas canonical)", () => {
  it("pier-cli-user-manual data.json 是使用手册真源而非开发波次文档", () => {
    expect(existsSync(CLI_USER_MANUAL_DATA_PATH)).toBe(true);
    expect(existsSync(join(ROOT, "docs/cli.md"))).toBe(false);

    const data = readCliUserManualData();
    expect(data.meta.title).toMatch(/CLI|命令行/u);
    expect(data.meta.status).toMatch(/使用手册/u);
    expect(data.bluf).toMatch(/先启动 Pier/u);
    expect(data.bluf).not.toMatch(/交付波次|W0–W6|W0-W6|金标准命令面/u);
    expect(JSON.stringify(data)).not.toMatch(
      /PIER_AGENT_CALLER_|agent-binding|effectKey|CapabilityAuthority/u
    );
    expect(`${data.context}\n${data.nonGoals.join("\n")}`).toMatch(
      /不是.*权限|不把 CLI 写成权限|不负责.*权限|权限系统/u
    );
  });

  it("shipped / planned / blocked 必现清单完整且字段齐全", () => {
    const data = readCliUserManualData();
    expect(collectInventoryMismatches(data)).toEqual([]);
  });

  it("shipped 命令不手抄易漂移的响应结构", () => {
    const data = readCliUserManualData();
    const copiedOutputs = listCliManualCommands(data)
      .filter((command) => command.status === "shipped" && command.output)
      .map((command) => command.name);
    expect(copiedOutputs).toEqual([]);
  });

  it("shipped 表面不得把未实现 agents / 插件写权写成默认可执行", () => {
    const data = readCliUserManualData();
    const available = collectCliManualShippedSurfaceText(data);
    expect(collectCliDocsAvailableViolations(available)).toEqual([]);
    expect(available).toMatch(/plugins list/u);
    expect(available).toMatch(/agents catalog/u);
    expect(available).toMatch(/status/u);
    expect(available).not.toMatch(/^\s*pier\s+access\b/mu);
  });

  it("产品入口文档指向 Canvas 且不得再引 docs/cli.md", () => {
    for (const path of [
      "README.md",
      "docs/README.md",
      "docs/development.md",
    ] as const) {
      const text = readFile(path);
      expect(text, path).toMatch(/pier-cli-user-manual/u);
      expect(text, path).not.toMatch(/docs\/cli\.md/u);
    }
  });
});
