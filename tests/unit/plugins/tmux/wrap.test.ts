import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installShim } from "../../../../packages/plugin-tmux/src/main/install-shim.ts";
import {
  allocatePane,
  loadSessionMap,
  parseTmuxValue,
  saveSessionMap,
} from "../../../../packages/plugin-tmux/src/main/session-map.ts";
import {
  decorateLaunchSpawn,
  wrapLaunch,
} from "../../../../packages/plugin-tmux/src/main/wrap.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function wrapInput(
  overrides: Partial<{ agentId: string; command: string }> = {}
) {
  return {
    agentId: overrides.agentId ?? "claude",
    command: overrides.command ?? "claude",
    env: {},
  };
}

describe("pier.tmux wrap T1/T2", () => {
  it("prepends bin for any interactive assistant while the plugin is active", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pier-tmux-wrap-"));
    dirs.push(workDir);
    const claude = wrapLaunch(wrapInput(), { workDir });
    expect(claude).toEqual({
      decorateSpawn: true,
      pathPrepend: [join(workDir, "bin")],
    });
    expect(claude).not.toHaveProperty("env");
    expect(claude).not.toHaveProperty("command");
    expect(JSON.stringify(claude)).not.toContain(
      "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"
    );

    const opencode = wrapLaunch(wrapInput({ agentId: "opencode" }), {
      workDir,
    });
    expect(opencode.pathPrepend).toEqual([join(workDir, "bin")]);
    expect(JSON.stringify(opencode)).not.toContain("OPENCODE_CONFIG_DIR");

    const omp = wrapLaunch(wrapInput({ agentId: "omp", command: "omp" }), {
      workDir,
    });
    expect(omp).toEqual({
      decorateSpawn: true,
      pathPrepend: [join(workDir, "bin")],
    });
    const codex = wrapLaunch(
      wrapInput({ agentId: "codex", command: "codex" }),
      { workDir }
    );
    expect(codex.decorateSpawn).toBe(true);
  });

  it("skips blank terminals, empty commands, and one-shot launches", () => {
    const workDir = "/tmp/pier-tmux-unused";
    expect(wrapLaunch(wrapInput({ agentId: "" }), { workDir })).toEqual({});
    expect(wrapLaunch(wrapInput({ agentId: "   " }), { workDir })).toEqual({});
    expect(wrapLaunch(wrapInput({ command: "   " }), { workDir })).toEqual({});
    expect(
      wrapLaunch(wrapInput({ command: "claude -p 'hello'" }), { workDir })
    ).toEqual({});
    expect(
      wrapLaunch(wrapInput({ command: "claude --print" }), { workDir })
    ).toEqual({});
  });

  it("isolates leaders in the same window and keeps inherited split panes", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pier-tmux-wrap-"));
    dirs.push(workDir);
    const first = decorateLaunchSpawn(
      {
        agentId: "claude",
        env: {},
        panelId: "panel-a",
        windowId: "win-a",
      },
      { workDir }
    );
    expect(first.env?.TMUX_PANE).toBe("%0");
    expect(first.env?.TMUX).toContain(`${join(workDir, "sessions")}/`);
    expect(first.env?.TMUX).toMatch(/\.sock,\d+,0$/u);
    const firstParsed = parseTmuxValue(first.env?.TMUX ?? "");
    expect(firstParsed).not.toBeNull();
    expect(
      loadSessionMap(workDir, firstParsed?.sessionId ?? "")?.panes["%0"]
        ?.panelId
    ).toBe("panel-a");

    const second = decorateLaunchSpawn(
      {
        agentId: "claude",
        env: {},
        panelId: "panel-b",
        windowId: "win-a",
      },
      { workDir }
    );
    expect(second.env?.TMUX_PANE).toBe("%0");
    expect(second.env?.TMUX).not.toBe(first.env?.TMUX);
    expect(
      loadSessionMap(workDir, firstParsed?.sessionId ?? "")?.panes["%0"]
        ?.panelId
    ).toBe("panel-a");

    const map = loadSessionMap(workDir, firstParsed?.sessionId ?? "");
    expect(map).not.toBeNull();
    if (!map) {
      throw new Error("expected leader session map");
    }
    const allocated = allocatePane(map, {
      panelId: "panel-split",
      windowId: "win-a",
      splitAxis: "horizontal",
    });
    saveSessionMap(workDir, allocated.map);
    const child = decorateLaunchSpawn(
      {
        agentId: "claude",
        env: {
          TMUX: first.env?.TMUX ?? "",
          TMUX_PANE: allocated.paneId,
        },
        panelId: "panel-split",
        windowId: "win-a",
      },
      { workDir }
    );
    expect(child.env?.TMUX).toBe(first.env?.TMUX);
    expect(child.env?.TMUX_PANE).toBe(allocated.paneId);

    const pending = decorateLaunchSpawn(
      {
        agentId: "claude",
        env: {
          TMUX: first.env?.TMUX ?? "",
          TMUX_PANE: "%2",
        },
        panelId: "panel-pending",
        windowId: "win-a",
      },
      { workDir }
    );
    expect(pending.env?.TMUX).toBe(first.env?.TMUX);
    expect(pending.env?.TMUX_PANE).toBe("%2");
    expect(
      loadSessionMap(workDir, firstParsed?.sessionId ?? "")?.panes["%0"]
        ?.panelId
    ).toBe("panel-a");
  });

  it("installs the PATH binary with a node shebang", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pier-tmux-wrap-"));
    dirs.push(workDir);
    const sourcePath = join(workDir, "tmux.js");
    await writeFile(sourcePath, "console.log('ok');\n", "utf8");
    await chmod(sourcePath, 0o644);
    const dest = installShim({ sourcePath, workDir });
    expect(dest).toBe(join(workDir, "bin", "tmux"));
    const body = await readFile(dest, "utf8");
    expect(body.startsWith("#!/usr/bin/env node\n")).toBe(true);
    const modeBits = (await stat(dest)).mode.toString(8).slice(-3);
    expect(modeBits).toBe("755");
  });
});
