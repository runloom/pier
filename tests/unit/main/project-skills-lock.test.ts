import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import type { StableProjectIdentity } from "@main/services/project-skills/identity.ts";
import {
  createProjectSkillsLock,
  ProjectSkillsLockBusy,
} from "@main/services/project-skills/lock.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let sharedLockRoot: string;

const identityA: StableProjectIdentity = {
  directoryIdentity: "1:10:1",
  realPath: "/tmp/project-a",
  volumeId: "vol-1",
};

const identityB: StableProjectIdentity = {
  directoryIdentity: "1:20:1",
  realPath: "/tmp/project-b",
  volumeId: "vol-1",
};

beforeEach(async () => {
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-project-skills-lock-"));
});

afterEach(async () => {
  await rm(sharedLockRoot, { force: true, recursive: true });
});

describe("project-skills lock", () => {
  it("requires an injected FilePathTransactionLock singleton", () => {
    expect(() =>
      // @ts-expect-error intentional missing injection
      createProjectSkillsLock({ sharedLockRoot })
    ).toThrow(/transactionLock/i);
  });

  it("serializes runExclusive for the same project identity", async () => {
    const transactionLock = new FilePathTransactionLock();
    const lock = createProjectSkillsLock({
      sharedLockRoot,
      transactionLock,
    });
    const order: string[] = [];
    const firstGate = Promise.withResolvers<void>();
    const firstEntered = Promise.withResolvers<void>();

    const first = lock.runExclusive(identityA, ["/tmp/a"], async () => {
      order.push("first-enter");
      firstEntered.resolve();
      await firstGate.promise;
      order.push("first-exit");
      return "first";
    });

    await firstEntered.promise;

    const secondEntered = Promise.withResolvers<void>();
    let secondStarted = false;
    const second = lock.runExclusive(identityA, ["/tmp/a"], async () => {
      secondStarted = true;
      order.push("second-enter");
      secondEntered.resolve();
      return "second";
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    firstGate.resolve();
    await expect(first).resolves.toBe("first");
    await secondEntered.promise;
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first-enter", "first-exit", "second-enter"]);
  });

  it("holds FilePathTransactionLock over the provided paths while exclusive", async () => {
    const transactionLock = new FilePathTransactionLock();
    const lock = createProjectSkillsLock({
      sharedLockRoot,
      transactionLock,
    });

    const exclusiveGate = Promise.withResolvers<void>();
    const exclusiveEntered = Promise.withResolvers<void>();

    const exclusive = lock.runExclusive(
      identityA,
      ["/project/root", "/profile/a/project-skills"],
      async () => {
        exclusiveEntered.resolve();
        await exclusiveGate.promise;
        return "done";
      }
    );

    await exclusiveEntered.promise;

    let concurrentEntered = false;
    const concurrentEnteredSignal = Promise.withResolvers<void>();
    const concurrent = transactionLock.run(
      ["/project/root/file.txt"],
      async () => {
        concurrentEntered = true;
        concurrentEnteredSignal.resolve();
        return "path-ok";
      }
    );

    // Overlapping path work must wait until exclusive releases the transaction lock.
    await Promise.resolve();
    await Promise.resolve();
    expect(concurrentEntered).toBe(false);

    exclusiveGate.resolve();
    await expect(exclusive).resolves.toBe("done");
    await concurrentEnteredSignal.promise;
    await expect(concurrent).resolves.toBe("path-ok");
    expect(concurrentEntered).toBe(true);
  });

  it("allows different project identities to proceed without mutual exclusion on project lock", async () => {
    const transactionLock = new FilePathTransactionLock();
    const lock = createProjectSkillsLock({
      sharedLockRoot,
      transactionLock,
    });

    let aInside = false;
    let bSawA = false;
    const aGate = Promise.withResolvers<void>();
    const aEntered = Promise.withResolvers<void>();

    const a = lock.runExclusive(identityA, ["/a"], async () => {
      aInside = true;
      aEntered.resolve();
      await aGate.promise;
      aInside = false;
      return "a";
    });

    await aEntered.promise;

    const b = lock.runExclusive(identityB, ["/b"], async () => {
      bSawA = aInside;
      return "b";
    });

    await expect(b).resolves.toBe("b");
    expect(bSawA).toBe(true);
    aGate.resolve();
    await expect(a).resolves.toBe("a");
  });

  it("uses shared lock root path so two lock instances serialize the same identity", async () => {
    const lock1 = createProjectSkillsLock({
      sharedLockRoot,
      transactionLock: new FilePathTransactionLock(),
    });
    const lock2 = createProjectSkillsLock({
      sharedLockRoot,
      transactionLock: new FilePathTransactionLock(),
    });

    const order: string[] = [];
    const gate = Promise.withResolvers<void>();
    const firstEntered = Promise.withResolvers<void>();

    const first = lock1.runExclusive(identityA, ["/p1"], async () => {
      order.push("l1-enter");
      firstEntered.resolve();
      await gate.promise;
      order.push("l1-exit");
      return 1;
    });

    await firstEntered.promise;

    let secondEntered = false;
    const secondDone = Promise.withResolvers<void>();
    const second = lock2.runExclusive(identityA, ["/p2"], async () => {
      secondEntered = true;
      order.push("l2-enter");
      secondDone.resolve();
      return 2;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(secondEntered).toBe(false);
    gate.resolve();
    await expect(first).resolves.toBe(1);
    await secondDone.promise;
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["l1-enter", "l1-exit", "l2-enter"]);
  });

  it("returns typed operation-busy when exclusive wait exceeds timeout", async () => {
    const lock = createProjectSkillsLock({
      // Zero budget: first contended attempt must fail busy without waiting.
      acquireTimeoutMs: 0,
      sharedLockRoot,
      transactionLock: new FilePathTransactionLock(),
    });

    const holderGate = Promise.withResolvers<void>();
    const holderEntered = Promise.withResolvers<void>();

    const holder = lock.runExclusive(identityA, ["/x"], async () => {
      holderEntered.resolve();
      await holderGate.promise;
      return "held";
    });

    await holderEntered.promise;

    await expect(
      lock.runExclusive(identityA, ["/x"], async () => "nope")
    ).rejects.toBeInstanceOf(ProjectSkillsLockBusy);

    holderGate.resolve();
    await expect(holder).resolves.toBe("held");
  });
});
