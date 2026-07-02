import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalStatusBarPrefsStore } from "@main/state/terminal-status-bar-prefs.ts";
import type { TerminalStatusBarItemOverride } from "@shared/contracts/terminal-status-bar.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => {
      throw new Error("default store path must not be resolved in tests");
    }),
  },
}));

const tempDirs: string[] = [];

async function prefsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-status-bar-prefs-"));
  tempDirs.push(dir);
  return join(dir, "terminal-status-bar-prefs.json");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("terminal status bar prefs store", () => {
  it("文件不存在时返回空默认值", async () => {
    const store = createTerminalStatusBarPrefsStore(await prefsFile());
    await expect(store.getAll()).resolves.toEqual({ items: {}, version: 1 });
  });

  it("setItemOverride / resetItem 往返并落盘持久化", async () => {
    const filePath = await prefsFile();
    const store = createTerminalStatusBarPrefsStore(filePath);

    await expect(
      store.setItemOverride("pier.worktree.status", {
        alignment: "right",
        hidden: true,
      })
    ).resolves.toEqual({
      items: {
        "pier.worktree.status": { alignment: "right", hidden: true },
      },
      version: 1,
    });
    await store.flush();

    // 新实例从磁盘读回
    const reloaded = createTerminalStatusBarPrefsStore(filePath);
    await expect(reloaded.getAll()).resolves.toEqual({
      items: {
        "pier.worktree.status": { alignment: "right", hidden: true },
      },
      version: 1,
    });

    await expect(reloaded.resetItem("pier.worktree.status")).resolves.toEqual({
      items: {},
      version: 1,
    });
    await reloaded.flush();
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      items: {},
      version: 1,
    });
  });

  it("resetItem 不存在的 key 是幂等 no-op", async () => {
    const store = createTerminalStatusBarPrefsStore(await prefsFile());
    await expect(store.resetItem("nope")).resolves.toEqual({
      items: {},
      version: 1,
    });
  });

  it("空 override 等价 resetItem(不存空对象)", async () => {
    const store = createTerminalStatusBarPrefsStore(await prefsFile());
    await store.setItemOverride("a.b", { hidden: true });
    await expect(store.setItemOverride("a.b", {})).resolves.toEqual({
      items: {},
      version: 1,
    });
  });

  it("损坏 JSON / schema 不合法时重置为默认值", async () => {
    const corrupt = await prefsFile();
    await writeFile(corrupt, "{ not json", "utf8");
    const store = createTerminalStatusBarPrefsStore(corrupt);
    await expect(store.getAll()).resolves.toEqual({ items: {}, version: 1 });

    const badVersion = await prefsFile();
    await writeFile(
      badVersion,
      `${JSON.stringify({ items: {}, version: 99 })}\n`,
      "utf8"
    );
    const store2 = createTerminalStatusBarPrefsStore(badVersion);
    await expect(store2.getAll()).resolves.toEqual({ items: {}, version: 1 });
  });

  it("setItemOverride 拒绝 schema 非法的 override", async () => {
    const store = createTerminalStatusBarPrefsStore(await prefsFile());
    // 经 JSON.parse 构造运行时非法值,走 zod 校验路径;
    // as 到具体类型是常规窄化,不用 @ts 抑制指令、不用 as any。
    const invalid = JSON.parse(
      '{"alignment":"center"}'
    ) as TerminalStatusBarItemOverride;
    await expect(store.setItemOverride("a.b", invalid)).rejects.toThrow();
  });

  describe("applyItemOverridePatch(F7:main 侧合成,消除 read-modify-write 竞态)", () => {
    it("单次 patch 合成并落盘", async () => {
      const store = createTerminalStatusBarPrefsStore(await prefsFile());
      await expect(
        store.applyItemOverridePatch("a.b", { hidden: true })
      ).resolves.toEqual({
        items: { "a.b": { hidden: true } },
        version: 1,
      });
    });

    it("两次“并发”patch 顺序应用后两字段都在(不丢字段)", async () => {
      const store = createTerminalStatusBarPrefsStore(await prefsFile());
      // 模拟同一 itemId 上两个几乎同时发起的 patch —— main 单线程串行处理,
      // 各自读自身当时的最新状态合成,不会互相覆盖对方已提交的字段。
      const first = store.applyItemOverridePatch("a.b", { hidden: true });
      const second = store.applyItemOverridePatch("a.b", { order: 20 });
      await Promise.all([first, second]);
      await expect(store.getAll()).resolves.toEqual({
        items: { "a.b": { hidden: true, order: 20 } },
        version: 1,
      });
    });

    it("patch 清空全部字段时改走删除该 key", async () => {
      const store = createTerminalStatusBarPrefsStore(await prefsFile());
      await store.applyItemOverridePatch("a.b", { hidden: true });
      await expect(
        store.applyItemOverridePatch("a.b", { hidden: null })
      ).resolves.toEqual({ items: {}, version: 1 });
    });
  });

  describe("applyItemOverridePatches(F8:批量原子应用)", () => {
    it("一次 mutate 应用全部 patch,全部落盘", async () => {
      const filePath = await prefsFile();
      const store = createTerminalStatusBarPrefsStore(filePath);
      await expect(
        store.applyItemOverridePatches({
          "a.b": { order: 0 },
          "c.d": { order: 10 },
        })
      ).resolves.toEqual({
        items: { "a.b": { order: 0 }, "c.d": { order: 10 } },
        version: 1,
      });
      await store.flush();
      const reloaded = createTerminalStatusBarPrefsStore(filePath);
      await expect(reloaded.getAll()).resolves.toEqual({
        items: { "a.b": { order: 0 }, "c.d": { order: 10 } },
        version: 1,
      });
    });

    it("批量中某项 patch 清空字段时该项从 items 删除,其余项保留", async () => {
      const store = createTerminalStatusBarPrefsStore(await prefsFile());
      await store.applyItemOverridePatch("a.b", { hidden: true });
      await expect(
        store.applyItemOverridePatches({
          "a.b": { hidden: null },
          "c.d": { order: 5 },
        })
      ).resolves.toEqual({
        items: { "c.d": { order: 5 } },
        version: 1,
      });
    });

    it("空 patches 对象是 no-op,返回当前状态", async () => {
      const store = createTerminalStatusBarPrefsStore(await prefsFile());
      await store.applyItemOverridePatch("a.b", { hidden: true });
      await expect(store.applyItemOverridePatches({})).resolves.toEqual({
        items: { "a.b": { hidden: true } },
        version: 1,
      });
    });
  });
});
