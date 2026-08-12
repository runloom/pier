import { createWorktreeIncarnationStore } from "@main/services/git/worktree/incarnation-store.ts";
import { describe, expect, it } from "vitest";

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
});
