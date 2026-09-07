import { describe, expect, it } from "vitest";
import { ComposerAttachmentQueue } from "@/panel-kits/terminal/composer/attachment-queue.ts";

describe("composer attachment queue", () => {
  it("settles queued callers on disposal without waiting for the active job", async () => {
    const queue = new ComposerAttachmentQueue();
    const gate = Promise.withResolvers<void>();
    const started: string[] = [];
    const settled: string[] = [];
    const active = queue.enqueue(async () => {
      started.push("active");
      await gate.promise;
    });
    active.then(() => settled.push("active"));
    const firstQueued = queue.enqueue(() => {
      started.push("first queued");
    });
    const secondQueued = queue.enqueue(() => {
      started.push("second queued");
    });
    firstQueued.then(() => settled.push("first queued"));
    secondQueued.then(() => settled.push("second queued"));
    await Promise.resolve();
    expect(started).toEqual(["active"]);

    queue.dispose();
    queue.dispose();
    await Promise.resolve();
    try {
      expect(settled).toEqual(["first queued", "second queued"]);
      await queue.enqueue(() => {
        started.push("after disposal");
      });
      expect(started).toEqual(["active"]);
    } finally {
      gate.resolve();
      await Promise.all([active, firstQueued, secondQueued]);
    }
    expect(settled).toEqual(["first queued", "second queued", "active"]);
    expect(started).toEqual(["active"]);
  });

  it("skips all work when disposed before the first microtask", async () => {
    const queue = new ComposerAttachmentQueue();
    const started: string[] = [];
    const first = queue.enqueue(() => {
      started.push("first");
    });
    const second = queue.enqueue(() => {
      started.push("second");
    });
    expect(started).toEqual([]);
    queue.dispose();
    await Promise.all([first, second]);
    expect(started).toEqual([]);
  });

  it("continues serially after synchronous throws and asynchronous rejections", async () => {
    const queue = new ComposerAttachmentQueue();
    const gate = Promise.withResolvers<void>();
    const started: string[] = [];
    const syncError = new Error("synchronous attachment failure");
    const asyncError = new Error("asynchronous attachment failure");
    const first = queue.enqueue(() => {
      started.push("first");
      throw syncError;
    });
    const second = queue.enqueue(() => {
      started.push("second");
      return gate.promise;
    });
    const third = queue.enqueue(() => {
      started.push("third");
    });
    const firstRejected = expect(first).rejects.toBe(syncError);
    const secondRejected = expect(second).rejects.toBe(asyncError);
    expect(started).toEqual([]);
    await firstRejected;
    try {
      expect(started).toEqual(["first", "second"]);
    } finally {
      gate.reject(asyncError);
      await secondRejected;
      await third;
    }
    expect(started).toEqual(["first", "second", "third"]);

    await queue.enqueue(() => {
      started.push("after idle");
    });
    expect(started).toEqual(["first", "second", "third", "after idle"]);
  });
});
