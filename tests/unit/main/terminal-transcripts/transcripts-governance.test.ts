import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTerminalTranscriptsService,
  TRANSCRIPT_DROP_MARKER_PREFIX,
  TranscriptSegmentWriter,
} from "../../../../src/main/services/terminal-transcripts/index.ts";

const directories: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-transcripts-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("terminal transcripts 有界性治理", () => {
  it("按段上限轮转并 gzip 封段；尾部读跨段拼接", async () => {
    const root = await makeRoot();
    const service = createTerminalTranscriptsService({
      maxSegmentBytes: 64,
      rootDir: root,
    });

    // 3 × 40B → 至少轮转出多个段。
    service.append("run-a", "a".repeat(40));
    service.append("run-a", "b".repeat(40));
    service.append("run-a", "c".repeat(40));
    await service.seal("run-a");

    const files = (await readdir(join(root, "run-a"))).sort();
    expect(files.length).toBeGreaterThanOrEqual(2);
    // 封段后全部为 gzip 压缩段。
    expect(files.every((name) => name.endsWith(".log.gz"))).toBe(true);

    const tail = await service.readTailText("run-a", 50);
    expect(tail.length).toBeLessThanOrEqual(50);
    expect(tail.endsWith("c".repeat(40))).toBe(true);

    const full = await service.readTailText("run-a", 10_000);
    expect(full).toBe("a".repeat(40) + "b".repeat(40) + "c".repeat(40));
    await service.dispose();
  });

  it("内存队列有界：溢出丢弃并写缺口标记，append 永不阻塞", async () => {
    const root = await makeRoot();
    const writer = new TranscriptSegmentWriter({
      dir: join(root, "run-b"),
      maxQueueBytes: 128,
      maxSegmentBytes: 1024 * 1024,
    });

    // 同步猛灌远超队列上限的数据：调用方永不阻塞、队列不超限。
    for (let index = 0; index < 100; index += 1) {
      writer.append("x".repeat(64));
      expect(writer.queuedBytes).toBeLessThanOrEqual(128 + 64);
    }
    expect(writer.droppedBytes).toBeGreaterThan(0);
    await writer.seal();

    const service = createTerminalTranscriptsService({ rootDir: root });
    const text = await service.readTailText("run-b", 1024 * 1024);
    expect(text).toContain(TRANSCRIPT_DROP_MARKER_PREFIX);
    await service.dispose();
  });

  it("全局配额按 LRU 淘汰非活体 lifecycle，活体不淘汰", async () => {
    const root = await makeRoot();
    // 段封存后 gzip（重复内容压到 ~30B/段），配额取 50B 保证触发淘汰。
    const service = createTerminalTranscriptsService({
      globalQuotaBytes: 50,
      rootDir: root,
    });

    // 三个已封存 lifecycle（各 ~100B），mtime 从旧到新。
    for (const [index, id] of ["old", "mid", "new"].entries()) {
      service.append(id, "x".repeat(100));
      await service.seal(id);
      const files = await readdir(join(root, id));
      const stamp = new Date(2026, 0, index + 1);
      for (const name of files) {
        await utimes(join(root, id), stamp, stamp);
        await utimes(join(root, id, name), stamp, stamp);
      }
    }
    // 活体 lifecycle：有 writer 存在，不允许淘汰。
    service.append("live", "y".repeat(100));

    await service.enforceQuota();

    const remaining = (await readdir(root)).sort();
    expect(remaining).not.toContain("old");
    expect(remaining).toContain("new");
    expect(remaining).toContain("live");
    await service.dispose();
  });

  it("lifecycle 目录名净化：路径分隔符不逃逸根目录", async () => {
    const root = await makeRoot();
    const service = createTerminalTranscriptsService({ rootDir: root });
    service.append("../escape/run", "data");
    await service.dispose();

    const entries = await readdir(root);
    expect(entries).toEqual([".._escape_run"]);
    // 根目录之外不产生文件。
    await expect(readdir(join(root, ".."))).resolves.not.toContain("escape");
  });

  it("lifecycle 目录名净化：`.` / `..` 不能逃逸或别名根目录", async () => {
    const root = await makeRoot();
    const service = createTerminalTranscriptsService({ rootDir: root });
    service.append(".", "dot");
    service.append("..", "dotdot");
    await service.dispose();

    const entries = (await readdir(root)).sort();
    expect(entries).toEqual(["_.", "_.."]);
    expect(await service.readTailText(".", 1024)).toBe("dot");
    expect(await service.readTailText("..", 1024)).toBe("dotdot");
  });

  it("全局配额不淘汰 native tap 仍在写的 lifecycle", async () => {
    const root = await makeRoot();
    const service = createTerminalTranscriptsService({
      globalQuotaBytes: 50,
      rootDir: root,
    });
    service.append("old", "x".repeat(100));
    await service.seal("old");
    const stamp = new Date(2026, 0, 1);
    for (const name of await readdir(join(root, "old"))) {
      await utimes(join(root, "old"), stamp, stamp);
      await utimes(join(root, "old", name), stamp, stamp);
    }
    await mkdir(join(root, "term-live"), { recursive: true });
    await writeFile(join(root, "term-live", "000001.log"), "y".repeat(100));
    service.markNativeLive("term-live");

    await service.enforceQuota();

    const remaining = (await readdir(root)).sort();
    expect(remaining).not.toContain("old");
    expect(remaining).toContain("term-live");
    await service.dispose();
  });

  it("截断按未压缩体积判定，不用 gzip 磁盘大小", async () => {
    const root = await makeRoot();
    const service = createTerminalTranscriptsService({
      maxSegmentBytes: 64,
      rootDir: root,
    });
    service.append("run-gz", "a".repeat(40));
    service.append("run-gz", "b".repeat(40));
    service.append("run-gz", "c".repeat(40));
    await service.seal("run-gz");

    const tail = await service.readTail("run-gz", 50);
    expect(tail.truncated).toBe(true);
    expect(tail.totalUncompressedBytes).toBeGreaterThan(50);
    expect(tail.text.endsWith("c".repeat(40))).toBe(true);
    await service.dispose();
  });

  it("main writer 重启后从已有最大段号之后开新段", async () => {
    const root = await makeRoot();
    const dir = join(root, "run-resume");
    const first = new TranscriptSegmentWriter({
      dir,
      maxSegmentBytes: 64,
    });
    first.append("a".repeat(40));
    first.append("b".repeat(40));
    await first.seal();

    const second = new TranscriptSegmentWriter({
      dir,
      maxSegmentBytes: 64,
    });
    second.append("c".repeat(40));
    await second.seal();

    const files = (await readdir(dir)).sort();
    expect(files.length).toBeGreaterThanOrEqual(3);
    const service = createTerminalTranscriptsService({ rootDir: root });
    expect(await service.readTailText("run-resume", 10_000)).toBe(
      "a".repeat(40) + "b".repeat(40) + "c".repeat(40)
    );
    await service.dispose();
  });

  it("配额清扫不影响读路径的段序", async () => {
    const root = await makeRoot();
    // 伪造非段文件：读路径忽略。
    const dir = join(root, "run-c");
    const service = createTerminalTranscriptsService({ rootDir: root });
    service.append("run-c", "hello ");
    service.append("run-c", "world");
    await service.seal("run-c");
    await writeFile(join(dir, "notes.txt"), "ignore me");

    expect(await service.readTailText("run-c", 1024)).toBe("hello world");
    const lifecycles = await service.listLifecycles();
    expect(lifecycles).toHaveLength(1);
    expect(lifecycles[0]?.live).toBe(false);
    await service.dispose();
  });
});
