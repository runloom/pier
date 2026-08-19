import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "packages", "plugin-tmux");
const SOURCE_RE = /\.(ts|tsx|js|mjs)$/;
const SKIP_DIRS = new Set(["dist", "dist-pkg", "node_modules"]);

const BANNED_LOCALE = [
  { id: "shim", re: /\bshim\b/iu },
  { id: "PATH", re: /\bPATH\b/u },
  { id: "TMUX", re: /\bTMUX\b/u },
  { id: "teams", re: /\bteams\b/iu },
  { id: "omo", re: /\bomo\b/iu },
  { id: "选区", re: /选区/u },
  { id: "Agent", re: /\bAgent\b/u },
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

describe("pier.tmux plugin governance", () => {
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
        if (rule.re.test(value)) {
          hits.push(`${rule.id}: ${value}`);
        }
      }
    }
    expect(hits).toEqual([]);
    expect(manifest.commands ?? []).toEqual([]);
    expect(manifest.configuration).toBeUndefined();
    expect(manifest.settingsPages ?? []).toEqual([]);
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

  it("does not wrap third-party launch flags or ship a settings page", () => {
    const wrap = readFileSync(join(ROOT, "src", "main", "wrap.ts"), "utf8");
    expect(wrap).not.toContain("applyLaunchPresets");
    expect(wrap).not.toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
    expect(wrap).not.toContain("OPENCODE_CONFIG_DIR");
    expect(wrap).not.toContain("oh-my-openagent");
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
