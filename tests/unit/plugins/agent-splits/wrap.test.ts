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
import { installShim } from "../../../../packages/plugin-agent-splits/src/main/install-shim.ts";
import { ensureOmoShadow } from "../../../../packages/plugin-agent-splits/src/main/omo-shadow.ts";
import {
  allocatePane,
  loadSessionMap,
  parseTmuxValue,
  saveSessionMap,
} from "../../../../packages/plugin-agent-splits/src/main/session-map.ts";
import {
  decorateLaunchSpawn,
  wrapLaunch,
} from "../../../../packages/plugin-agent-splits/src/main/wrap.ts";

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

describe("pier.agent-splits wrap T1/T2", () => {
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

  it("master switch off disables the bridge for every agent", () => {
    const result = wrapLaunch(
      { agentId: "claude", command: "claude", env: {} },
      {
        workDir: "/tmp/unused",
        getConfig: (key) => key !== "pier.agent-splits.adapter.enabled",
      }
    );
    expect(result).toEqual({});
  });

  it("per-agent switch only gates that agent", () => {
    const getConfig = (key: string): unknown =>
      key !== "pier.agent-splits.adapter.agents.claude";
    expect(
      wrapLaunch(
        { agentId: "claude", command: "claude", env: {} },
        { workDir: "/tmp/unused", getConfig }
      )
    ).toEqual({});
    expect(
      wrapLaunch(
        { agentId: "opencode", command: "opencode", env: {} },
        { workDir: "/tmp/unused", getConfig }
      ).decorateSpawn
    ).toBe(true);
    expect(
      wrapLaunch(
        { agentId: "cursor-agent", command: "cursor-agent", env: {} },
        { workDir: "/tmp/unused", getConfig }
      ).decorateSpawn
    ).toBe(true);
  });

  it("missing user values keep the bridge enabled (schema defaults true)", () => {
    const result = wrapLaunch(
      { agentId: "claude", command: "claude", env: {} },
      { workDir: "/tmp/unused", getConfig: () => undefined }
    );
    expect(result.decorateSpawn).toBe(true);
  });

  it("claude teams preset injects env and teammate-mode once", () => {
    const result = wrapLaunch(
      { agentId: "claude", command: "claude", env: {} },
      {
        workDir: "/tmp/unused",
        getConfig: () => true,
      }
    );
    expect(result.env).toMatchObject({
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
    });
    expect(result.command).toBe("claude --teammate-mode auto");
    const again = wrapLaunch(
      {
        agentId: "claude",
        command: "claude --teammate-mode manual",
        env: {},
      },
      {
        workDir: "/tmp/unused",
        getConfig: () => true,
      }
    );
    // 已含 --teammate-mode：不重复追加，command 原样（宿主保持原命令）。
    expect(again.command).toBeUndefined();
  });

  it("omo preset writes shadow config and injects port once", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pier-omo-preset-"));
    dirs.push(workDir);
    const result = wrapLaunch(
      { agentId: "opencode", command: "opencode", env: {} },
      {
        workDir,
        getConfig: () => true,
        ensureOmoShadow,
      }
    );
    expect(result.env).toMatchObject({
      OPENCODE_CONFIG_DIR: join(workDir, "omo-config"),
      OPENCODE_PORT: "4096",
    });
    expect(result.command).toBe("opencode --port 4096");
    const config = JSON.parse(
      await readFile(join(workDir, "omo-config", "config.json"), "utf8")
    );
    expect(config.plugin).toContain("oh-my-openagent");
    expect(config.tmux_visualization).toBe(true);

    const withPort = wrapLaunch(
      { agentId: "opencode", command: "opencode --port 7777", env: {} },
      {
        workDir,
        getConfig: () => true,
        ensureOmoShadow,
      }
    );
    // 已含 --port：不重复注入。
    expect(withPort.command).toBeUndefined();
  });

  it("presets stay inert when off or adapter gated", async () => {
    const off = wrapLaunch(
      { agentId: "claude", command: "claude", env: {} },
      { workDir: "/tmp/unused", getConfig: () => false }
    );
    expect(off.env).toBeUndefined();
    expect(off.command).toBeUndefined();

    const gated = wrapLaunch(
      { agentId: "claude", command: "claude", env: {} },
      {
        workDir: "/tmp/unused",
        getConfig: (key) => key !== "pier.agent-splits.adapter.enabled",
      }
    );
    expect(gated).toEqual({});
  });
});
