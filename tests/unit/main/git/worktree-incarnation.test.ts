import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWorktreeIncarnationStore } from "@main/services/git/worktree/incarnation-store.ts";
import { describe, expect, it, vi } from "vitest";

describe("WorktreeIncarnationStore", () => {
  it("ensure reuses id; mint always replaces; forget clears", async () => {
    const mem = new Map<string, string>();
    let n = 0;
    const factory = createWorktreeIncarnationStore({
      async load() {
        return {
          version: 1,
          byPath: Object.fromEntries(mem),
        };
      },
      async save(_main, data) {
        mem.clear();
        for (const [k, v] of Object.entries(data.byPath)) {
          mem.set(k, v);
        }
      },
      uuid: () => {
        n += 1;
        return `id-${n}`;
      },
    });
    const store = factory("/tmp/main-repo");
    const a = await store.ensure("/tmp/main-repo.worktree/f1");
    const b = await store.ensure("/tmp/main-repo.worktree/f1");
    expect(a).toBe("id-1");
    expect(b).toBe("id-1");
    const c = await store.mint("/tmp/main-repo.worktree/f1");
    expect(c).toBe("id-2");
    const d = await store.ensure("/tmp/main-repo.worktree/f1");
    expect(d).toBe("id-2");
    await store.forget("/tmp/main-repo.worktree/f1");
    const e = await store.ensure("/tmp/main-repo.worktree/f1");
    expect(e).toBe("id-3");
  });

  it("mint survives when disk load shares process memory (no map alias wipe)", async () => {
    // 回归：readMap 若返回 live Map，writeMap 清空 mem 会连 mint 一起抹掉。
    let n = 0;
    const factory = createWorktreeIncarnationStore({
      uuid: () => {
        n += 1;
        return `id-${n}`;
      },
    });
    const store = factory("/tmp/alias-main");
    const minted = await store.mint("/tmp/alias-main.worktree/x");
    expect(minted).toBe("id-1");
    const ensured = await store.ensure("/tmp/alias-main.worktree/x");
    expect(ensured).toBe("id-1");
  });

  it("持久化到 storeRootDir 下按主仓库分片，不写 mainPath/.pier", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-incarnation-"));
    try {
      const userData = join(root, "userData");
      const repo = join(root, "repo");
      let n = 0;
      const factory = createWorktreeIncarnationStore({
        storeRootDir: userData,
        uuid: () => {
          n += 1;
          return `id-${n}`;
        },
      });
      const id = await factory(repo).mint(join(repo, "wt", "f1"));
      expect(id).toBe("id-1");

      // 写到 userData 下按主仓库哈希分片，且不污染仓库根 .pier
      const digest = createHash("sha256").update(resolve(repo)).digest("hex");
      const shard = join(userData, "worktree-incarnations", `${digest}.json`);
      expect(existsSync(shard)).toBe(true);
      expect(
        existsSync(join(repo, ".pier", "worktree-incarnations.json"))
      ).toBe(false);

      // 写盘内容正确：byPath 记录的是 mint 出的 id
      const onDisk = JSON.parse(await readFile(shard, "utf8")) as {
        byPath: Record<string, string>;
      };
      expect(onDisk.byPath[resolve(join(repo, "wt", "f1"))]).toBe("id-1");

      // 模拟重启：清空模块级内存缓存，ensure 必须从磁盘读取（而非 memoryByMain）
      vi.resetModules();
      const fresh = await import(
        "@main/services/git/worktree/incarnation-store.ts"
      );
      const ensured = await fresh
        .createWorktreeIncarnationStore({
          storeRootDir: userData,
          uuid: () => {
            n += 1;
            return `id-${n}`;
          },
        })(repo)
        .ensure(join(repo, "wt", "f1"));
      expect(ensured).toBe("id-1");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
