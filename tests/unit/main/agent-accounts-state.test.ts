import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentAccountsStateStore } from "@main/state/agent-accounts-state.ts";
import { afterEach, describe, expect, it } from "vitest";

describe("agent-accounts-state", () => {
  const tempFiles: string[] = [];

  function tempPath(): string {
    const p = join(
      tmpdir(),
      `pier-accounts-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    tempFiles.push(p);
    return p;
  }

  afterEach(async () => {
    await Promise.all(tempFiles.splice(0).map((f) => rm(f, { force: true })));
  });

  it("init 无文件时返回默认值", async () => {
    const store = createAgentAccountsStateStore(tempPath());
    const state = await store.init();
    expect(state).toEqual({
      accounts: [],
      activeAccountId: null,
      version: 1,
    });
  });

  it("mutate 后 get 立即反映新状态", async () => {
    const store = createAgentAccountsStateStore(tempPath());
    await store.init();
    store.mutate((s) => ({
      ...s,
      accounts: [
        {
          createdAt: 1000,
          email: "a@b.com",
          id: "id-1",
          provider: "codex" as const,
          updatedAt: 1000,
        },
      ],
      activeAccountId: "id-1",
    }));
    const state = store.get();
    expect(state.accounts).toHaveLength(1);
    expect(state.activeAccountId).toBe("id-1");
  });

  it("flush + 重新 init 实现持久化 round-trip", async () => {
    const filePath = tempPath();
    const store1 = createAgentAccountsStateStore(filePath);
    await store1.init();
    store1.mutate((s) => ({
      ...s,
      accounts: [
        {
          createdAt: 2000,
          email: "c@d.com",
          id: "id-2",
          provider: "codex" as const,
          updatedAt: 2000,
        },
      ],
      activeAccountId: "id-2",
    }));
    await store1.flush();

    const store2 = createAgentAccountsStateStore(filePath);
    const reloaded = await store2.init();
    expect(reloaded.accounts).toHaveLength(1);
    expect(reloaded.accounts[0]?.email).toBe("c@d.com");
    expect(reloaded.activeAccountId).toBe("id-2");
    expect(reloaded.version).toBe(1);
  });

  it("损坏文件回退默认值", async () => {
    const filePath = tempPath();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "not valid json {{{");
    const store = createAgentAccountsStateStore(filePath);
    const state = await store.init();
    expect(state).toEqual({
      accounts: [],
      activeAccountId: null,
      version: 1,
    });
  });
});
