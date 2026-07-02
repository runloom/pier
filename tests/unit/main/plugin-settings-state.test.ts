import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getDefaultPluginSettingsStore 在懒初始化时才读 app.getPath；
// 本测试全部走 createPluginSettingsStore({ filePath }) 注入，electron 仅需可 import。
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/unused-in-this-test") },
}));

import { createPluginSettingsStore } from "@main/state/plugin-settings.ts";

describe("plugin-settings store (L1)", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-plugin-settings-"));
    filePath = join(tempDir, "plugin-settings.json");
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("setValue 后内存立即可读，flush 后落盘", async () => {
    const store = createPluginSettingsStore({ filePath });
    await store.init();
    store.setValue("pier.git.statusItem.showDirtyIndicator", false);
    expect(store.getValues()).toEqual({
      "pier.git.statusItem.showDirtyIndicator": false,
    });
    await store.flush();
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    expect(raw).toEqual({
      values: { "pier.git.statusItem.showDirtyIndicator": false },
      version: 1,
    });
  });

  it("resetValue 删除 key（恢复默认 = 删除存储值）", async () => {
    const store = createPluginSettingsStore({ filePath });
    await store.init();
    store.setValue("pier.a.x", 3);
    const next = store.resetValue("pier.a.x");
    expect(next.values).toEqual({});
  });

  it("损坏 JSON 与 schema 不合法均重置为默认值", async () => {
    await writeFile(filePath, "{not json");
    const corrupt = createPluginSettingsStore({ filePath });
    expect((await corrupt.init()).values).toEqual({});

    const badVersionPath = join(tempDir, "bad-version.json");
    await writeFile(
      badVersionPath,
      `${JSON.stringify({ values: {}, version: 99 })}\n`
    );
    const badVersion = createPluginSettingsStore({ filePath: badVersionPath });
    expect((await badVersion.init()).version).toBe(1);
  });

  it("重启读回持久化值", async () => {
    const first = createPluginSettingsStore({ filePath });
    await first.init();
    first.setValue("pier.a.x", "manual");
    await first.flush();

    const second = createPluginSettingsStore({ filePath });
    expect((await second.init()).values).toEqual({ "pier.a.x": "manual" });
  });
});
