import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStoreManager } from "@main/services/agent-managed-assets/store.ts";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
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
