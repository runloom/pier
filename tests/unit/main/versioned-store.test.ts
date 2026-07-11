import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Migration,
  type VersionedStoreOpts,
  versionedJsonStore,
} from "@main/state/versioned-store.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// ── 测试用 schema + defaults ────────────────────────────────────

const v1Schema = z.object({
  version: z.literal(1),
  name: z.string(),
});
type V1 = z.infer<typeof v1Schema>;

const v1Defaults: V1 = { version: 1, name: "default" };

const v2Schema = z.object({
  version: z.literal(2),
  name: z.string(),
  count: z.number(),
});
type V2 = z.infer<typeof v2Schema>;

const v2Defaults: V2 = { version: 2, name: "default", count: 0 };

// ── 迁移链 ──────────────────────────────────────────────────────

const migrateV0toV1: Migration = {
  from: 0,
  to: 1,
  migrate: (data) => {
    const d = (typeof data === "object" && data !== null ? data : {}) as Record<
      string,
      unknown
    >;
    return { name: typeof d.label === "string" ? d.label : "migrated" };
  },
};

const migrateV1toV2: Migration = {
  from: 1,
  to: 2,
  migrate: (data) => {
    const d = data as Record<string, unknown>;
    return { ...d, count: 0 };
  },
};

// ── 辅助 ────────────────────────────────────────────────────────

function makeOpts<T>(
  filePath: string,
  overrides: Partial<VersionedStoreOpts<T>> & {
    currentVersion: number;
    schema: z.ZodType<T>;
    defaults: T;
  }
): VersionedStoreOpts<T> {
  return {
    filePath,
    migrations: [],
    debounceMs: 10,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe("versionedJsonStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-versioned-store-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("首次 init（无文件）→ defaults + 写入 version", async () => {
    const filePath = join(tempDir, "state.json");
    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
      })
    );

    const state = await store.init();
    expect(state).toEqual(v1Defaults);

    await store.flush();
    const disk = JSON.parse(await readFile(filePath, "utf-8"));
    expect(disk.version).toBe(1);
    expect(disk.name).toBe("default");
  });

  it("v0 旧文件（无 version 字段）→ 跑 v0→v1 迁移", async () => {
    const filePath = join(tempDir, "state.json");
    await writeFile(filePath, JSON.stringify({ label: "hello" }));

    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
        migrations: [migrateV0toV1],
      })
    );

    const state = await store.init();
    expect(state).toEqual({ version: 1, name: "hello" });

    await store.flush();
    const disk = JSON.parse(await readFile(filePath, "utf-8"));
    expect(disk.version).toBe(1);
    expect(disk.name).toBe("hello");
  });

  it("v1 已存 → 不跑迁移", async () => {
    const filePath = join(tempDir, "state.json");
    const existing: V1 = { version: 1, name: "existing" };
    await writeFile(filePath, JSON.stringify(existing));

    const migrateSpy = vi.fn(migrateV0toV1.migrate);
    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
        migrations: [{ ...migrateV0toV1, migrate: migrateSpy }],
      })
    );

    const state = await store.init();
    expect(state).toEqual(existing);
    expect(migrateSpy).not.toHaveBeenCalled();
  });

  it("损坏 JSON → backup + defaults", async () => {
    const filePath = join(tempDir, "state.json");
    const corrupt = "{{{not valid json!!!";
    await writeFile(filePath, corrupt);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
      })
    );

    const state = await store.init();
    expect(state).toEqual(v1Defaults);

    // 备份文件应存在
    const backupPath = `${filePath}.backup-v0`;
    expect(existsSync(backupPath)).toBe(true);
    const backupContent = await readFile(backupPath, "utf-8");
    expect(backupContent).toBe(corrupt);

    // 应打印错误日志
    expect(errorSpy).toHaveBeenCalledWith(
      "[versioned-store] migration failed:",
      expect.anything()
    );

    errorSpy.mockRestore();
  });

  it("迁移链 v0→v1→v2", async () => {
    const filePath = join(tempDir, "state.json");
    await writeFile(filePath, JSON.stringify({ label: "chain" }));

    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 2,
        schema: v2Schema,
        defaults: v2Defaults,
        migrations: [migrateV0toV1, migrateV1toV2],
      })
    );

    const state = await store.init();
    expect(state).toEqual({ version: 2, name: "chain", count: 0 });

    await store.flush();
    const disk = JSON.parse(await readFile(filePath, "utf-8"));
    expect(disk.version).toBe(2);
    expect(disk.name).toBe("chain");
    expect(disk.count).toBe(0);
  });

  it("schema 校验失败 → backup + defaults（version 匹配但字段非法）", async () => {
    const filePath = join(tempDir, "state.json");
    // version 对但 name 是 number 而非 string
    await writeFile(filePath, JSON.stringify({ version: 1, name: 42 }));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
      })
    );

    const state = await store.init();
    expect(state).toEqual(v1Defaults);

    const backupPath = `${filePath}.backup-v1`;
    expect(existsSync(backupPath)).toBe(true);

    errorSpy.mockRestore();
  });

  it("迁移函数抛异常 → backup + defaults", async () => {
    const filePath = join(tempDir, "state.json");
    await writeFile(filePath, JSON.stringify({ label: "boom" }));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const throwingMigration: Migration = {
      from: 0,
      to: 1,
      migrate: () => {
        throw new Error("migration exploded");
      },
    };

    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
        migrations: [throwingMigration],
      })
    );

    const state = await store.init();
    expect(state).toEqual(v1Defaults);

    const backupPath = `${filePath}.backup-v0`;
    expect(existsSync(backupPath)).toBe(true);

    errorSpy.mockRestore();
  });

  it("顶层非 object → 当作 v0 跑迁移", async () => {
    const filePath = join(tempDir, "state.json");
    // 顶层是数组而非 object
    await writeFile(filePath, JSON.stringify([1, 2, 3]));

    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
        migrations: [migrateV0toV1],
      })
    );

    const state = await store.init();
    // migrateV0toV1 对非 object 走 fallback → name: "migrated"
    expect(state).toEqual({ version: 1, name: "migrated" });
  });

  it("mutate/replace/get 接口行为与 DebouncedJsonStore 一致", async () => {
    const filePath = join(tempDir, "state.json");
    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
      })
    );

    await store.init();

    // mutate
    const mutated = store.mutate((s) => ({ ...s, name: "mutated" }));
    expect(mutated.name).toBe("mutated");
    expect(store.get().name).toBe("mutated");

    // replace
    const replaced = store.replace({ version: 1, name: "replaced" });
    expect(replaced.name).toBe("replaced");
    expect(store.get().name).toBe("replaced");

    // flush 写入磁盘
    await store.flush();
    const disk = JSON.parse(await readFile(filePath, "utf-8"));
    expect(disk.name).toBe("replaced");
  });

  it("get() 在 init() 前抛异常", () => {
    const filePath = join(tempDir, "state.json");
    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
      })
    );

    expect(() => store.get()).toThrow("init() must be called before get()");
  });

  it("clear() 重置为 defaults 并删文件", async () => {
    const filePath = join(tempDir, "state.json");
    const store = versionedJsonStore(
      makeOpts(filePath, {
        currentVersion: 1,
        schema: v1Schema,
        defaults: v1Defaults,
      })
    );

    await store.init();
    store.mutate((s) => ({ ...s, name: "changed" }));
    await store.flush();
    expect(existsSync(filePath)).toBe(true);

    await store.clear();
    expect(store.get()).toEqual(v1Defaults);
    expect(existsSync(filePath)).toBe(false);
  });
});
