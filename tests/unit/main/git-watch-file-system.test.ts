import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchReadText } from "@main/services/git-watch-file-system.ts";
import { afterEach, describe, expect, it } from "vitest";

let temporaryRoot = "";

describe("Git watch shared file-system probes", () => {
  afterEach(async () => {
    if (temporaryRoot) {
      await rm(temporaryRoot, { force: true, recursive: true });
      temporaryRoot = "";
    }
  });

  it("同路径共享读取不由首个调用方取消，后续调用方仍可完成", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "pier-watch-read-"));
    const path = join(temporaryRoot, "msgnum");
    await writeFile(path, "7\n");
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = watchReadText(path, { signal: firstController.signal });
    const second = watchReadText(path, { signal: secondController.signal });

    // 底层共享读取在 microtask 中启动；此时取消首个 waiter，能确定性证明
    // 原始 readFile 没有继承首个调用方的 signal。
    firstController.abort();

    await expect(first).rejects.toThrow();
    await expect(second).resolves.toBe("7\n");
  });
});
