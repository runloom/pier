import type { PluginSettingsChangedPayload } from "@shared/contracts/plugin-settings.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initPluginSettingsStore,
  subscribePluginSettingsChanges,
  usePluginSettingsStore,
} from "@/stores/plugin-settings.store.ts";

type BroadcastListener = (payload: PluginSettingsChangedPayload) => void;

describe("usePluginSettingsStore", () => {
  let broadcastListener: BroadcastListener | null;
  const setMock = vi.fn();
  const resetMock = vi.fn();
  const getAllMock = vi.fn();

  beforeEach(() => {
    broadcastListener = null;
    setMock.mockReset();
    resetMock.mockReset();
    getAllMock.mockReset();
    usePluginSettingsStore.setState({
      error: null,
      initialized: false,
      values: {},
    });
    vi.stubGlobal("window", {
      ...window,
      pier: {
        pluginSettings: {
          getAll: getAllMock,
          onChanged: (cb: BroadcastListener) => {
            broadcastListener = cb;
            return () => {
              broadcastListener = null;
            };
          },
          reset: resetMock,
          set: setMock,
        },
      },
    });
  });

  it("init 全量拉取并订阅广播", async () => {
    getAllMock.mockResolvedValue({ values: { "pier.a.x": 1 }, version: 1 });
    await initPluginSettingsStore();
    expect(usePluginSettingsStore.getState()).toMatchObject({
      initialized: true,
      values: { "pier.a.x": 1 },
    });
    expect(broadcastListener).not.toBeNull();
  });

  it("set 在 resolve 路径同步镜像并通知 changedKeys", async () => {
    getAllMock.mockResolvedValue({ values: {}, version: 1 });
    await initPluginSettingsStore();
    setMock.mockResolvedValue({ values: { "pier.a.x": false }, version: 1 });
    const changes: string[][] = [];
    subscribePluginSettingsChanges((keys) => changes.push([...keys]));

    await usePluginSettingsStore.getState().set("pier.a.x", false);
    expect(usePluginSettingsStore.getState().values).toEqual({
      "pier.a.x": false,
    });
    expect(changes).toEqual([["pier.a.x"]]);
  });

  it("广播与 resolve 双投递按 diff 去重", async () => {
    getAllMock.mockResolvedValue({ values: {}, version: 1 });
    await initPluginSettingsStore();
    setMock.mockResolvedValue({ values: { "pier.a.x": false }, version: 1 });
    const changes: string[][] = [];
    subscribePluginSettingsChanges((keys) => changes.push([...keys]));

    await usePluginSettingsStore.getState().set("pier.a.x", false);
    broadcastListener?.({
      changedKeys: ["pier.a.x"],
      values: { "pier.a.x": false },
    });
    expect(changes).toEqual([["pier.a.x"]]);
  });

  it("reset resolve 路径同步删除", async () => {
    getAllMock.mockResolvedValue({
      values: { "pier.a.x": false },
      version: 1,
    });
    await initPluginSettingsStore();
    resetMock.mockResolvedValue({ values: {}, version: 1 });

    await usePluginSettingsStore.getState().reset("pier.a.x");
    expect(usePluginSettingsStore.getState().values).toEqual({});
  });

  it("init 拉取失败时置 error 且不抛出、initialized 仍置 true", async () => {
    getAllMock.mockRejectedValue(new Error("ipc boom"));
    await expect(initPluginSettingsStore()).resolves.toEqual(
      expect.any(Function)
    );
    expect(usePluginSettingsStore.getState().error).toBe("ipc boom");
    expect(usePluginSettingsStore.getState().initialized).toBe(true);
    expect(usePluginSettingsStore.getState().values).toEqual({});
  });

  it("set IPC 失败时置 error 并 rethrow、values 不变", async () => {
    getAllMock.mockResolvedValue({ values: { "pier.a.x": 1 }, version: 1 });
    await initPluginSettingsStore();
    const valuesBefore = usePluginSettingsStore.getState().values;
    setMock.mockRejectedValue(new Error("ipc boom"));

    await expect(
      usePluginSettingsStore.getState().set("pier.a.x", 2)
    ).rejects.toThrow("ipc boom");
    expect(usePluginSettingsStore.getState().error).toBe("ipc boom");
    expect(usePluginSettingsStore.getState().values).toBe(valuesBefore);
  });

  it("reset IPC 失败时置 error 并 rethrow、values 不变", async () => {
    getAllMock.mockResolvedValue({ values: { "pier.a.x": 1 }, version: 1 });
    await initPluginSettingsStore();
    const valuesBefore = usePluginSettingsStore.getState().values;
    resetMock.mockRejectedValue(new Error("ipc boom"));

    await expect(
      usePluginSettingsStore.getState().reset("pier.a.x")
    ).rejects.toThrow("ipc boom");
    expect(usePluginSettingsStore.getState().error).toBe("ipc boom");
    expect(usePluginSettingsStore.getState().values).toBe(valuesBefore);
  });

  it("失败后成功操作会清空 error", async () => {
    getAllMock.mockResolvedValue({ values: {}, version: 1 });
    await initPluginSettingsStore();
    setMock.mockRejectedValueOnce(new Error("ipc boom"));
    await expect(
      usePluginSettingsStore.getState().set("pier.a.x", false)
    ).rejects.toThrow("ipc boom");
    expect(usePluginSettingsStore.getState().error).toBe("ipc boom");

    setMock.mockResolvedValue({ values: { "pier.a.x": false }, version: 1 });
    await usePluginSettingsStore.getState().set("pier.a.x", false);
    expect(usePluginSettingsStore.getState().error).toBeNull();
    expect(usePluginSettingsStore.getState().values).toEqual({
      "pier.a.x": false,
    });
  });
});
