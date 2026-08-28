import { createReadStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MEMORY_ENTITY_TYPES } from "@shared/contracts/agent/memory.ts";
import { MEMORY_JSONL_MAX_BYTES } from "./jsonl.ts";

/**
 * 存量迁移(一次性):记忆根从 userData 移到 `~/.pier/memory`。
 * userData 路径含 build 名(Pier / Pier-dev),写进项目 MCP 配置的绝对路径会随
 * build 失效;`~/.pier` 是本 App 机器级、跨实例资产的既定约定(hooks/技能锁同款)。
 * 目标已存在或旧根不存在时不动;账本随目录整体搬迁,配置里的旧路径由
 * enable 收敛按账本指纹识别本体后重写。
 */
export function migrateLegacyMemoryBaseDir(
  legacyDir: string,
  baseDir: string
): void {
  if (existsSync(baseDir) || !existsSync(legacyDir)) {
    return;
  }
  mkdirSync(dirname(baseDir), { recursive: true });
  renameSync(legacyDir, baseDir);
}

// 与列表读取共用同一上限(单一来源)。
const MAX_SCAN_BYTES = MEMORY_JSONL_MAX_BYTES;
const COUNTED_ENTITY_TYPES: readonly string[] = MEMORY_ENTITY_TYPES;

export class MemoryStoreManager {
  readonly #baseDir: string;

  constructor(options: { baseDir: string }) {
    this.#baseDir = options.baseDir;
  }

  async ensure(key: string): Promise<{ storePath: string }> {
    const dir = join(this.#baseDir, key);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storePath = join(dir, "memory.jsonl");
    const handle = await open(storePath, "a", 0o600);
    await handle.close();
    return { storePath };
  }

  async stats(storePath: string): Promise<{
    entities: number | null;
    observations: number | null;
  }> {
    const info = await stat(storePath).catch(() => null);
    if (!info || info.size > MAX_SCAN_BYTES) {
      return { entities: null, observations: null };
    }
    let entities = 0;
    let observations = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(storePath, { encoding: "utf8" });
      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk;
        let idx = buffer.indexOf("\n");
        while (idx >= 0) {
          this.#countLine(
            buffer.slice(0, idx),
            (entityDelta, observationDelta) => {
              entities += entityDelta;
              observations += observationDelta;
            }
          );
          buffer = buffer.slice(idx + 1);
          idx = buffer.indexOf("\n");
        }
      });
      stream.on("end", () => {
        this.#countLine(buffer, (entityDelta, observationDelta) => {
          entities += entityDelta;
          observations += observationDelta;
        });
        resolve();
      });
      stream.on("error", reject);
    });
    return { entities, observations };
  }

  #countLine(
    line: string,
    sink: (entities: number, observations: number) => void
  ): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const row = JSON.parse(trimmed) as {
        entityType?: string;
        observations?: unknown[];
        type?: string;
      };
      // 与设置页列表同口径:只计四类 entityType,计数与可见条目一致。
      if (
        row.type === "entity" &&
        typeof row.entityType === "string" &&
        COUNTED_ENTITY_TYPES.includes(row.entityType)
      ) {
        sink(1, Array.isArray(row.observations) ? row.observations.length : 0);
      }
    } catch {
      // 破损行容忍
    }
  }
}
