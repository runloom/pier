import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

/** 已删除的磁盘历史 / 热窗收缩 / 状态栏查看器——复活即 finding。 */
const BANNED_PATHS = [
  "src/main/services/terminal-transcripts/service.ts",
  "src/main/services/terminal-transcripts/app-wiring.ts",
  "src/main/ipc/terminal/transcripts/hot-window-pressure.ts",
  "src/main/ipc/terminal/transcripts/tail-ipc.ts",
  "src/renderer/panel-kits/terminal/status-items/history.tsx",
  "native/Sources/GhosttyBridge/TranscriptTap.swift",
];

describe("terminal scrollback governance", () => {
  it("locks AGENTS.md: visible history is ghostty scrollback only", () => {
    const agents = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8");
    expect(agents).toContain(
      "### 终端 scrollback `0108-live-scrollback-limit`"
    );
    expect(agents).not.toContain("终端历史三层化");
    expect(agents).not.toContain("hot-window-pressure.ts");
  });

  it("does not ship disk transcripts, history viewer, or hidden-tab shrink", () => {
    for (const relative of BANNED_PATHS) {
      expect(existsSync(join(REPO_ROOT, relative))).toBe(false);
    }
    const ipc = readFileSync(
      join(REPO_ROOT, "src/main/ipc/terminal/index.ts"),
      "utf8"
    );
    expect(ipc).not.toContain("transcript-tail");
    const ids = readFileSync(
      join(REPO_ROOT, "src/shared/plugin-core-contribution-ids.ts"),
      "utf8"
    );
    expect(ids).not.toContain("core.terminal-history");
  });
});
