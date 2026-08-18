import { delimiter } from "node:path";
import {
  applyDecorateSpawnT2,
  applyLaunchWrapForCreate,
  applyWrapT1,
  assertLaunchWrapCapability,
  registerLaunchWrapHandler,
  resetLaunchWrapRegistryForTests,
} from "@main/services/terminal-launch-wrap/index.ts";
import {
  resetDefaultLogSinkForTests,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const PREPEND = "/tmp/pier-wrap-bin";

afterEach(() => {
  resetLaunchWrapRegistryForTests();
  resetDefaultLogSinkForTests();
});

describe("launch wrap T1/T2", () => {
  it("rejects register without terminal:launchWrap", () => {
    expect(() =>
      assertLaunchWrapCapability("pier.other", ["terminal:control"])
    ).toThrow(/terminal:launchWrap/u);
    expect(() =>
      assertLaunchWrapCapability("pier.wrap.test", ["terminal:launchWrap"])
    ).not.toThrow();
  });

  it("applies pathPrepend at T1 without panel identity, then T2 sees PIER_* after panel id is known", async () => {
    const wrap = vi.fn(async () => ({
      decorateSpawn: true,
      pathPrepend: [PREPEND],
    }));
    const decorateSpawn = vi.fn(
      async (input: {
        env: Record<string, string>;
        panelId: string;
        windowId: string;
      }) => {
        expect(input.env.PIER_CONTROL_SOCKET).toBe("/tmp/pier-control.sock");
        expect(input.env.PIER_WINDOW_ID).toBe("win-1");
        expect(input.env.PIER_PANEL_ID).toBe("panel-9");
        expect(input.panelId).toBe("panel-9");
        expect(input.windowId).toBe("win-1");
        return { env: { PIER_WRAP_MARK: "1" } };
      }
    );
    registerLaunchWrapHandler("pier.wrap.test", { wrap, decorateSpawn });

    const t1 = await applyWrapT1({
      agentId: "claude",
      command: "claude",
      env: { PATH: "/usr/bin" },
    });
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(decorateSpawn).not.toHaveBeenCalled();
    expect(t1.decorateSpawn).toBe(true);
    expect(t1.launch.env?.PATH?.split(delimiter)[0]).toBe(PREPEND);
    expect(t1.launch.env?.PIER_PANEL_ID).toBeUndefined();
    expect(t1.launch.env?.PIER_WINDOW_ID).toBeUndefined();
    expect(t1.launch.env?.PIER_CONTROL_SOCKET).toBeUndefined();

    const spawned = await applyLaunchWrapForCreate({
      agentId: "claude",
      controlSocketPath: "/tmp/pier-control.sock",
      hookEnv: {},
      launch: t1.launch,
      panelId: "panel-9",
      windowId: "win-1",
    });
    expect(decorateSpawn).toHaveBeenCalledTimes(1);
    expect(spawned.env?.PIER_WRAP_MARK).toBe("1");
    expect(spawned.env?.PIER_PANEL_ID).toBe("panel-9");
  });

  it("skips wrap and decorateSpawn for blank terminals", async () => {
    const wrap = vi.fn(async () => ({ decorateSpawn: true }));
    const decorateSpawn = vi.fn(async () => ({ env: { MARK: "1" } }));
    registerLaunchWrapHandler("pier.wrap.test", { wrap, decorateSpawn });

    const spawned = await applyLaunchWrapForCreate({
      agentId: undefined,
      hookEnv: {},
      launch: { command: "/bin/zsh" },
      panelId: "blank-1",
      windowId: "7",
    });
    expect(wrap).not.toHaveBeenCalled();
    expect(decorateSpawn).not.toHaveBeenCalled();
    expect(spawned.env?.PIER_PANEL_ID).toBe("blank-1");
    expect(spawned.env?.PIER_WINDOW_ID).toBe("7");
    expect(spawned.env?.MARK).toBeUndefined();
  });

  it("ignores the second non-empty decorateSpawn env and warns", async () => {
    const warnings: string[] = [];
    setDefaultLogSink((record) => {
      if (record.level === "warn") {
        warnings.push(record.msg);
      }
    });
    registerLaunchWrapHandler("pier.a", {
      wrap: async () => ({ decorateSpawn: true }),
      decorateSpawn: async () => ({ env: { FIRST: "1" } }),
    });
    registerLaunchWrapHandler("pier.b", {
      wrap: async () => ({ decorateSpawn: true }),
      decorateSpawn: async () => ({ env: { SECOND: "1" } }),
    });

    const t2 = await applyDecorateSpawnT2({
      agentId: "claude",
      launch: {
        agentId: "claude",
        command: "claude",
        env: { PATH: "/usr/bin" },
      },
      panelId: "p1",
      windowId: "w1",
    });
    expect(t2.launch.env?.FIRST).toBe("1");
    expect(t2.launch.env?.SECOND).toBeUndefined();
    expect(warnings.some((msg) => msg.includes("ignored extra env"))).toBe(
      true
    );
  });

  it("drops forbidden wrap and decorateSpawn env keys", async () => {
    registerLaunchWrapHandler("pier.wrap.test", {
      wrap: async () => ({
        decorateSpawn: true,
        env: {
          DYLD_INSERT_LIBRARIES: "/evil.dylib",
          NODE_OPTIONS: "--require evil",
          SAFE: "ok",
          TERM: "screen-256color",
        },
      }),
      decorateSpawn: async () => ({
        env: {
          DYLD_INSERT_LIBRARIES: "/evil.dylib",
          NODE_OPTIONS: "--require evil",
          SPAWN_SAFE: "ok",
          TERM: "screen-256color",
        },
      }),
    });

    const t1 = await applyWrapT1({
      agentId: "claude",
      command: "claude",
      env: { PATH: "/usr/bin" },
    });
    expect(t1.launch.env?.SAFE).toBe("ok");
    expect(t1.launch.env?.NODE_OPTIONS).toBeUndefined();
    expect(t1.launch.env?.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(t1.launch.env?.TERM).toBeUndefined();

    const t2 = await applyDecorateSpawnT2({
      agentId: "claude",
      launch: t1.launch,
      panelId: "p1",
      windowId: "w1",
    });
    expect(t2.launch.env?.SPAWN_SAFE).toBe("ok");
    expect(t2.launch.env?.NODE_OPTIONS).toBeUndefined();
    expect(t2.launch.env?.TERM).toBeUndefined();
  });

  it("still calls decorateSpawn when spawn env already has handler keys", async () => {
    const decorateSpawn = vi.fn(async () => ({ env: { MARK: "again" } }));
    registerLaunchWrapHandler("pier.wrap.test", {
      wrap: async () => ({ decorateSpawn: true }),
      decorateSpawn,
    });
    await applyDecorateSpawnT2({
      agentId: "claude",
      launch: {
        agentId: "claude",
        command: "claude",
        env: { MARK: "already" },
      },
      panelId: "new-panel",
      windowId: "w1",
    });
    expect(decorateSpawn).toHaveBeenCalledTimes(1);
  });
});
