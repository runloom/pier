import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import { describe, expect, it } from "vitest";

describe("FilePathTransactionLock", () => {
  it("serializes a file mutation behind its ancestor directory lock", async () => {
    const lock = new FilePathTransactionLock();
    const events: string[] = [];
    let releaseDirectory: () => void = () => undefined;
    const directory = lock.run(["/repo/src"], async () => {
      events.push("directory:start");
      await new Promise<void>((resolve) => {
        releaseDirectory = resolve;
      });
      events.push("directory:end");
    });
    await Promise.resolve();
    const file = lock.run(["/repo/src/file.ts"], async () => {
      events.push("file");
    });
    await Promise.resolve();
    expect(events).toEqual(["directory:start"]);

    releaseDirectory();
    await Promise.all([directory, file]);

    expect(events).toEqual(["directory:start", "directory:end", "file"]);
  });

  it("allows unrelated paths to proceed concurrently", async () => {
    const lock = new FilePathTransactionLock();
    const firstRelease = await lock.acquire(["/repo/a"]);

    const secondRelease = await lock.acquire(["/repo/b"]);

    secondRelease();
    firstRelease();
  });

  it("does not let a later descendant overtake an earlier directory request", async () => {
    const lock = new FilePathTransactionLock();
    const activeRelease = await lock.acquire(["/repo/src/active.ts"]);
    const events: string[] = [];
    let directoryRelease: () => void = () => undefined;
    const directory = lock.acquire(["/repo/src"]).then((release) => {
      events.push("directory");
      directoryRelease = release;
    });
    const laterFile = lock.acquire(["/repo/src/later.ts"]).then((release) => {
      events.push("later-file");
      release();
    });

    await Promise.resolve();
    expect(events).toEqual([]);
    activeRelease();
    await directory;
    expect(events).toEqual(["directory"]);

    directoryRelease();
    await laterFile;
    expect(events).toEqual(["directory", "later-file"]);
  });
});
