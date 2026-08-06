import type { CommentProjectSnapshot } from "@shared/contracts/comments/index.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginCommentsContext } from "@/lib/plugins/host/comments-context.ts";

const sampleSnapshot: CommentProjectSnapshot = {
  readState: { lastReadAt: 0 },
  seq: 1,
  threads: [],
  worktreeKey: "/repo",
};

/** 写操作断言必须与 main 侧 COMMAND_METADATA 严格对齐(见 permissions.ts)。 */
const WRITE_OPS = ["createThread", "deleteComment"] as const;

describe("plugin comments facade capability gating", () => {
  const api = {
    createThread: vi.fn(),
    deleteComment: vi.fn(),
    list: vi.fn(),
    listProjects: vi.fn(),
    onChanged: vi.fn(
      (_: (snapshot: CommentProjectSnapshot) => void) => () => undefined
    ),
  };

  beforeEach(() => {
    for (const fn of Object.values(api)) {
      fn.mockReset();
    }
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { comments: api },
    });
  });

  function makeContext(assert = vi.fn()) {
    return { assert, ctx: createPluginCommentsContext(undefined, assert) };
  }

  it("snapshot asserts comments:read and forwards list", async () => {
    api.list.mockResolvedValue({ kind: "ok", snapshot: sampleSnapshot });
    const { assert, ctx } = makeContext();
    await expect(ctx.snapshot("/repo")).resolves.toEqual(sampleSnapshot);
    expect(assert).toHaveBeenCalledWith(undefined, "comments:read");
    expect(api.list).toHaveBeenCalledWith({ worktreeKey: "/repo" });
  });

  it("snapshot returns null on failure without throwing", async () => {
    api.list.mockResolvedValue({ kind: "failure", message: "boom" });
    const { ctx } = makeContext();
    await expect(ctx.snapshot("/repo")).resolves.toBeNull();
  });

  it("watch asserts comments:read, forwards onChanged, filters by worktreeKey", () => {
    let broadcast: ((snapshot: CommentProjectSnapshot) => void) | undefined;
    api.onChanged.mockImplementation(
      (cb: (snapshot: CommentProjectSnapshot) => void) => {
        broadcast = cb;
        return () => undefined;
      }
    );
    const { assert, ctx } = makeContext();
    const listener = vi.fn();
    const dispose = ctx.watch("/repo", listener);
    expect(assert).toHaveBeenCalledWith(undefined, "comments:read");
    expect(api.onChanged).toHaveBeenCalledOnce();
    broadcast?.(sampleSnapshot);
    expect(listener).toHaveBeenCalledWith(sampleSnapshot);
    listener.mockReset();
    broadcast?.({ ...sampleSnapshot, worktreeKey: "/other" });
    expect(listener).not.toHaveBeenCalled();
    dispose();
  });

  it("listProjects asserts comments:read and forwards", async () => {
    api.listProjects.mockResolvedValue({ kind: "ok", projects: [] });
    const { assert, ctx } = makeContext();
    await ctx.listProjects({});
    expect(assert).toHaveBeenCalledWith(undefined, "comments:read");
    expect(api.listProjects).toHaveBeenCalledWith({});
  });

  for (const method of WRITE_OPS) {
    it(`${method} asserts comments:read + comments:write and forwards`, async () => {
      api[method].mockResolvedValue({ kind: "ok" });
      const { assert, ctx } = makeContext();
      await ctx[method]({} as never);
      expect(assert).toHaveBeenCalledWith(undefined, "comments:read");
      expect(assert).toHaveBeenCalledWith(undefined, "comments:write");
      expect(api[method]).toHaveBeenCalledWith({});
    });
  }

  it("does not reach preload when the capability assertion rejects", () => {
    const assert = vi.fn(() => {
      throw new Error("plugin capability not granted: comments:write");
    });
    const ctx = createPluginCommentsContext(undefined, assert);
    expect(() => ctx.createThread({} as never)).toThrow(/comments:write/);
    expect(api.createThread).not.toHaveBeenCalled();
  });
});
