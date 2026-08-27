import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryStoreManager,
  migrateLegacyMemoryBaseDir,
} from "@main/services/agent-managed-assets/store.ts";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("migrateLegacyMemoryBaseDir", () => {
  it("moves the legacy dir once and never clobbers an existing target", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-mem-migrate-"));
    dirs.push(root);
    const legacy = join(root, "userdata", "plugin-data", "pier.memory");
    const target = join(root, "dot-pier", "memory");
    mkdirSync(join(legacy, "k1"), { recursive: true });
    writeFileSync(join(legacy, "k1", "memory.jsonl"), "line\n");
    migrateLegacyMemoryBaseDir(legacy, target);
    expect(readFileSync(join(target, "k1", "memory.jsonl"), "utf8")).toBe(
      "line\n"
    );
    expect(existsSync(legacy)).toBe(false);
    // 目标已存在:即使又出现旧目录也不覆盖。
    mkdirSync(join(legacy, "k2"), { recursive: true });
    migrateLegacyMemoryBaseDir(legacy, target);
    expect(existsSync(join(legacy, "k2"))).toBe(true);
    expect(existsSync(join(target, "k2"))).toBe(false);
  });
});

describe("MemoryStoreManager", () => {
  it("ensures dir and file with tight permissions", async () => {
    const base = mkdtempSync(join(tmpdir(), "pier-mem-store-"));
    dirs.push(base);
    chmodSync(base, 0o755);
    const mgr = new MemoryStoreManager({ baseDir: base });
    const { storePath } = await mgr.ensure("abc");
    expect(storePath).toBe(join(base, "abc", "memory.jsonl"));
    expect((await stat(storePath)).mode.toString(8).slice(-3)).toBe("600");
  });

  it("counts entities and observations", async () => {
    const base = mkdtempSync(join(tmpdir(), "pier-mem-store-"));
    dirs.push(base);
    const mgr = new MemoryStoreManager({ baseDir: base });
    const { storePath } = await mgr.ensure("k");
    writeFileSync(
      storePath,
      [
        JSON.stringify({
          entityType: "convention",
          name: "P",
          observations: ["a", "b"],
          type: "entity",
        }),
        "not json",
        JSON.stringify({
          from: "P",
          relationType: "uses",
          to: "Q",
          type: "relation",
        }),
        // 非四类 entityType:与设置页列表同口径,不计数。
        JSON.stringify({
          entityType: "note",
          name: "X",
          observations: ["hidden"],
          type: "entity",
        }),
        "",
      ].join("\n")
    );
    expect(await mgr.stats(storePath)).toEqual({
      entities: 1,
      observations: 2,
    });
  });

  it("returns null counts over the size budget", async () => {
    const base = mkdtempSync(join(tmpdir(), "pier-mem-store-"));
    dirs.push(base);
    const mgr = new MemoryStoreManager({ baseDir: base });
    const { storePath } = await mgr.ensure("big");
    writeFileSync(storePath, "x".repeat(9 * 1024 * 1024));
    expect(await mgr.stats(storePath)).toEqual({
      entities: null,
      observations: null,
    });
  });
});
