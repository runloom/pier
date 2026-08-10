/**
 * W0 CLI 命令面治理：docs/cli.md 当前可用 vs 规划、能力表与 Canvas 对表、README 入口叙事。
 * 进入默认 pnpm test:unit / preflight 路径。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectCliDocsAvailableViolations,
  commandGroupStatusMatchesDocs,
  extractMarkdownSection,
  findCommandGroupMapLine,
} from "./cli-docs-surface.ts";

const ROOT = process.cwd();

function readCliMd(): string {
  return readFileSync(join(ROOT, "docs/cli.md"), "utf8");
}

function readReadme(): string {
  return readFileSync(join(ROOT, "README.md"), "utf8");
}

function readCanvasScheme(): {
  data: {
    cli: {
      commandGroups: Array<{ group: string; status: string; wave: string }>;
    };
  };
} {
  return JSON.parse(
    readFileSync(
      join(ROOT, ".pier/canvases/multi-agent-orchestration-gold/data.json"),
      "utf8"
    )
  ) as {
    data: {
      cli: {
        commandGroups: Array<{ group: string; status: string; wave: string }>;
      };
    };
  };
}

describe("cli-docs-surface helpers", () => {
  it.each([
    ["pier agents self --json", null],
    ["pier agents catalog --json", null],
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

describe("cli surface governance (W0)", () => {
  it("docs/cli.md 存在智能体优先与硬边界", () => {
    const md = readCliMd();
    expect(md).toMatch(/协调智能体/u);
    expect(md).toMatch(/任务生命周期|任务台账|完成判断|完成权/u);
    expect(md).toMatch(/transcript|history|replay/u);
    expect(md).toMatch(/交付波次|W0–W6|W0-W6/u);
  });

  it("「当前可用命令」不得列出规划主路径与默认无写权命令", () => {
    const available = extractMarkdownSection(readCliMd(), "当前可用命令");
    expect(collectCliDocsAvailableViolations(available)).toEqual([]);
    expect(available).toMatch(/plugin:write|cli-local/u);
  });

  it("规划章节保留 agents 地图且标明未实现", () => {
    const planned = extractMarkdownSection(
      readCliMd(),
      "规划中的 agents 主路径"
    );
    expect(planned).toMatch(/pier agents self/u);
    expect(planned).toMatch(/实现前|未实现|地图|规划/u);
  });

  it("isStrongEffectKey enforces >=128-bit opaque keys", async () => {
    const { isStrongEffectKey } = await import(
      "@main/adapters/cli/local-control-authorize.ts"
    );
    expect(isStrongEffectKey("short")).toBe(false);
    expect(isStrongEffectKey("aaaaaaaaaaaaaaaa")).toBe(false); // 16 chars
    expect(isStrongEffectKey("effect_key_0123456789ab")).toBe(true); // 22+
  });

  it("docs 能力地图覆盖 Canvas commandGroups 且 status 语义一致", () => {
    const scheme = readCanvasScheme();
    const md = readCliMd();
    const mapSection = extractMarkdownSection(
      md,
      "能力地图：金标准命令面 × 现状 × 波次"
    );

    for (const row of scheme.data.cli.commandGroups) {
      const line = findCommandGroupMapLine(mapSection, row.group);
      expect(line, `能力地图缺少命令组行: ${row.group}`).toBeTruthy();
      expect(
        commandGroupStatusMatchesDocs(line ?? "", row.status),
        `命令组 ${row.group} status=${row.status} 与地图行不一致: ${line}`
      ).toBe(true);
    }
  });

  it("README CLI 入口指向 docs/cli.md 且体现协调智能体主路径", () => {
    const readme = readReadme();
    expect(readme).toMatch(/docs\/cli\.md/u);
    expect(readme).toMatch(/协调智能体|智能体优先/u);
  });
});
