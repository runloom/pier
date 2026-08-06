import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextIdFor } from "@main/services/comments/identity.ts";
import { createCommentsService } from "@main/services/comments/service.ts";
import type { CommentProjectSnapshot } from "@shared/contracts/comments/index.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WORKTREE_KEY = "/repo";
const SCOPE = {
  contextId: contextIdFor(WORKTREE_KEY),
  gitRootPath: WORKTREE_KEY,
  target: { kind: "uncommitted" },
} as const;

const diffTarget = {
  blobOid: "0".repeat(40),
  group: "unstaged",
  kind: "git-diff",
  line: 5,
  oldPath: null,
  path: "src/a.ts",
  scope: SCOPE,
  side: "new",
} as const;

function makeService(dir: string) {
  let n = 0;
  let t = 1000;
  const broadcast = vi.fn<(snapshot: CommentProjectSnapshot) => void>();
  const service = createCommentsService({
    broadcast,
    idGen: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    now: () => (t += 100),
    userDataDir: dir,
  });
  return { service, broadcast };
}

describe("CommentsService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "comments-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a thread and lists it with seq incremented", async () => {
    const { service, broadcast } = makeService(dir);
    const created = await service.createThread({
      author: { kind: "user" },
      body: "first",
      target: diffTarget,
      worktreeKey: WORKTREE_KEY,
    });
    expect(created.kind).toBe("ok");
    const list = await service.list({ worktreeKey: WORKTREE_KEY });
    expect(list.kind).toBe("ok");
    if (list.kind !== "ok") {
      return;
    }
    expect(list.snapshot.threads).toHaveLength(1);
    expect(list.snapshot.threads[0]?.comments[0]?.body).toBe("first");
    expect(list.snapshot.seq).toBe(1);
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("rejects createThread when scope does not match worktreeKey", async () => {
    const { service } = makeService(dir);
    const result = await service.createThread({
      author: { kind: "user" },
      body: "x",
      target: {
        ...diffTarget,
        scope: {
          contextId: contextIdFor("/other"),
          gitRootPath: "/other",
          target: { kind: "uncommitted" },
        },
      },
      worktreeKey: WORKTREE_KEY,
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toBe("invalidSource");
    }
  });

  it("deletes a single-comment thread entirely", async () => {
    const { service } = makeService(dir);
    const created = await service.createThread({
      author: { kind: "user" },
      body: "first",
      target: diffTarget,
      worktreeKey: WORKTREE_KEY,
    });
    if (created.kind !== "ok") {
      throw new Error("createThread failed");
    }
    const list = await service.list({ worktreeKey: WORKTREE_KEY });
    if (list.kind !== "ok") {
      throw new Error("list failed");
    }
    const cid = list.snapshot.threads[0]?.comments[0]?.id;
    if (!cid) {
      throw new Error("comment missing");
    }
    await service.deleteComment({
      commentId: cid,
      threadId: created.threadId,
      worktreeKey: WORKTREE_KEY,
    });
    const after = await service.list({ worktreeKey: WORKTREE_KEY });
    if (after.kind !== "ok") {
      throw new Error("list failed");
    }
    // 单条批注：软删后整线程从列表移除。
    expect(after.snapshot.threads).toHaveLength(0);
  });

  it("updateComment rewrites the body and stamps editedAt", async () => {
    const { service } = makeService(dir);
    const created = await service.createThread({
      author: { kind: "user" },
      body: "first",
      target: diffTarget,
      worktreeKey: WORKTREE_KEY,
    });
    if (created.kind !== "ok") {
      throw new Error("createThread failed");
    }
    const list = await service.list({ worktreeKey: WORKTREE_KEY });
    if (list.kind !== "ok") {
      throw new Error("list failed");
    }
    const cid = list.snapshot.threads[0]?.comments[0]?.id;
    if (!cid) {
      throw new Error("comment missing");
    }
    const updated = await service.updateComment({
      body: "edited",
      commentId: cid,
      threadId: created.threadId,
      worktreeKey: WORKTREE_KEY,
    });
    expect(updated.kind).toBe("ok");
    const after = await service.list({ worktreeKey: WORKTREE_KEY });
    if (after.kind !== "ok") {
      throw new Error("list failed");
    }
    const comment = after.snapshot.threads[0]?.comments[0];
    expect(comment?.body).toBe("edited");
    expect(comment?.editedAt).toBeTypeOf("number");
    expect(after.snapshot.seq).toBe(2);
  });

  it("fails updateComment for an unknown thread", async () => {
    const { service } = makeService(dir);
    const result = await service.updateComment({
      body: "edited",
      commentId: "00000000-0000-4000-8000-000000000000",
      threadId: "00000000-0000-4000-8000-000000000001",
      worktreeKey: WORKTREE_KEY,
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toBe("threadNotFound");
    }
  });

  it("fails deleteComment for an unknown thread", async () => {
    const { service } = makeService(dir);
    const result = await service.deleteComment({
      commentId: "00000000-0000-4000-8000-000000000000",
      threadId: "00000000-0000-4000-8000-000000000001",
      worktreeKey: WORKTREE_KEY,
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toBe("threadNotFound");
    }
  });

  it("increments seq monotonically across create + delete", async () => {
    const { service } = makeService(dir);
    const created = await service.createThread({
      author: { kind: "user" },
      body: "first",
      target: diffTarget,
      worktreeKey: WORKTREE_KEY,
    });
    if (created.kind !== "ok") {
      throw new Error("createThread failed");
    }
    const list = await service.list({ worktreeKey: WORKTREE_KEY });
    if (list.kind !== "ok") {
      throw new Error("list failed");
    }
    const cid = list.snapshot.threads[0]?.comments[0]?.id;
    if (!cid) {
      throw new Error("comment missing");
    }
    await service.deleteComment({
      commentId: cid,
      threadId: created.threadId,
      worktreeKey: WORKTREE_KEY,
    });
    const after = await service.list({ worktreeKey: WORKTREE_KEY });
    if (after.kind !== "ok") {
      throw new Error("list failed");
    }
    expect(after.snapshot.seq).toBe(2);
  });

  it("listProjects reports the persisted project", async () => {
    const { service } = makeService(dir);
    await service.createThread({
      author: { kind: "user" },
      body: "first",
      target: diffTarget,
      worktreeKey: WORKTREE_KEY,
    });
    await service.flush();
    const result = await service.listProjects({});
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.projects.some((p) => p.worktreeKey === WORKTREE_KEY)).toBe(
        true
      );
    }
  });
});
