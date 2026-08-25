import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "packages", "plugin-agent-splits");
const SOURCE_RE = /\.(ts|tsx|js|mjs)$/;
const SKIP_DIRS = new Set(["dist", "dist-pkg", "node_modules"]);

const BANNED_LOCALE: Array<{ id: string; re: RegExp; cjkOnly?: boolean }> = [
  { id: "shim", re: /\bshim\b/iu },
  { id: "PATH", re: /\bPATH\b/u },
  { id: "TMUX", re: /\bTMUX\b/u },
  { id: "teams", re: /\bteams\b/iu },
  { id: "omo", re: /\bomo\b/iu },
  { id: "选区", re: /选区/u },
  // 「Agent」只在中英混写的中文值里禁用；纯英文 locale 是合法产品词。
  { id: "Agent", re: /\bAgent\b/u, cjkOnly: true },
  { id: "worktree", re: /\bworktree\b/iu },
] as const;

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        files.push(...walk(full));
      }
      continue;
    }
    files.push(full);
  }
  return files;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      collectStrings(child, out);
    }
  }
}

describe("pier.agent-splits plugin governance", () => {
  it("keeps locale values free of implementation words", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "plugin.json"), "utf8")
    ) as {
      commands?: unknown[];
      configuration?: unknown;
      locales?: unknown;
      settingsPages?: unknown[];
    };
    const strings: string[] = [];
    collectStrings(manifest.locales, strings);
    const hits: string[] = [];
    for (const value of strings) {
      for (const rule of BANNED_LOCALE) {
        if (rule.cjkOnly && !/[\u4e00-\u9fff]/u.test(value)) {
          continue;
        }
        if (rule.re.test(value)) {
          hits.push(`${rule.id}: ${value}`);
        }
      }
    }
    expect(hits).toEqual([]);
    expect(manifest.commands ?? []).toEqual([]);
    // 设置面（金标准 §8 / W3 §5）：单一适配器设置页 + 三个布尔键，默认全开。
    expect(manifest.settingsPages ?? []).toEqual([
      { id: "pier.agent-splits.adapter" },
    ]);
    const configuration = (manifest.configuration ?? {
      properties: {},
    }) as {
      properties: Record<string, { default?: unknown; type?: string }>;
    };
    const properties = configuration.properties;
    expect(Object.keys(properties).sort()).toEqual([
      "pier.agent-splits.adapter.agents.claude",
      "pier.agent-splits.adapter.agents.opencode",
      "pier.agent-splits.adapter.enabled",
      "pier.agent-splits.preset.claudeTeams",
      "pier.agent-splits.preset.opencodeOmo",
    ]);
    for (const [key, property] of Object.entries(properties)) {
      expect(property.type).toBe("boolean");
      // 适配器三键默认开；预设两键默认关（金标准 R5：映射 ≠ 替用户开实验功能）。
      expect(property.default).toBe(
        key.startsWith("pier.agent-splits.adapter.")
      );
    }
  });

  it("does not import dockview or spawn the human pier CLI", () => {
    const srcRoot = join(ROOT, "src");
    const offenders: string[] = [];
    for (const file of walk(srcRoot).filter((path) => SOURCE_RE.test(path))) {
      const text = readFileSync(file, "utf8");
      const rel = relative(ROOT, file);
      if (
        /from\s+["'][^"']*dockview/u.test(text) ||
        /dockview-(?:core|react)/u.test(text)
      ) {
        offenders.push(`${rel}: dockview`);
      }
      if (
        /\bpier\.mjs\b/u.test(text) ||
        /(?:^|[\s"'`])bin\/pier\b/u.test(text)
      ) {
        offenders.push(`${rel}: pier cli`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("preset sugar stays behind config keys; no hardcoded launch flags", () => {
    const wrap = readFileSync(join(ROOT, "src", "main", "wrap.ts"), "utf8");
    expect(wrap).not.toContain("applyLaunchPresets");
    // W4 预设（用户决策纳入）：env/参数名只经配置键门控，默认关。
    expect(wrap).toContain("PRESET_CLAUDE_TEAMS_KEY");
    expect(wrap).toContain("PRESET_OPENCODE_OMO_KEY");
    expect(wrap).toContain("getConfig?.(PRESET_CLAUDE_TEAMS_KEY) === true");
    // 方向 A（用户决策）：设置面回归——声明 settingsPage + configuration，
    // 渲染交给宿主自动表单（与其他设置项同一套 SwitchRow 形态）。
    const renderer = readFileSync(
      join(ROOT, "src", "renderer", "index.ts"),
      "utf8"
    );
    expect(renderer).not.toContain("settingsPages.register");
    expect(renderer).not.toContain("actions.register");
    expect(renderer).not.toContain("commands.register");
  });

  it("does not put the tmux verb table in pier.claude", () => {
    const claudeRoot = join(process.cwd(), "packages", "plugin-claude", "src");
    const hits: string[] = [];
    for (const file of walk(claudeRoot).filter((path) =>
      SOURCE_RE.test(path)
    )) {
      const text = readFileSync(file, "utf8");
      if (
        /\bsplit-window\b/u.test(text) ||
        /\bcapture-pane\b/u.test(text) ||
        /\bTMUX_PANE\b/u.test(text)
      ) {
        hits.push(relative(process.cwd(), file));
      }
    }
    expect(hits).toEqual([]);
  });
});
