import { readFile, stat } from "node:fs/promises";
import {
  MEMORY_ENTITY_TYPES,
  type MemoryListResult,
  type MemoryObservationItem,
} from "@shared/contracts/agent/memory.ts";
import writeFileAtomic from "write-file-atomic";

export const MEMORY_JSONL_MAX_BYTES = 8 * 1024 * 1024;
const ENTITY_TYPES: readonly string[] = MEMORY_ENTITY_TYPES;
interface EntityLine {
  entityType?: unknown;
  name?: unknown;
  observations?: unknown;
  type?: unknown;
}

function isEntityLine(row: EntityLine): row is EntityLine & {
  entityType: MemoryObservationItem["entityType"];
  name: string;
  observations: string[];
} {
  return (
    row.type === "entity" &&
    typeof row.name === "string" &&
    row.name.length > 0 &&
    typeof row.entityType === "string" &&
    ENTITY_TYPES.includes(row.entityType) &&
    Array.isArray(row.observations) &&
    row.observations.every((item) => typeof item === "string")
  );
}

export function parseMemoryItems(raw: string): MemoryObservationItem[] {
  const items: MemoryObservationItem[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let row: EntityLine;
    try {
      row = JSON.parse(trimmed) as EntityLine;
    } catch {
      continue;
    }
    if (!isEntityLine(row)) {
      continue;
    }
    row.observations.forEach((observation, index) => {
      if (observation.length === 0) {
        return;
      }
      items.push({
        entityName: row.name,
        entityType: row.entityType,
        index,
        observation,
      });
    });
  }
  return items;
}

/**
 * 按「实体名 + 下标 + 原文」三元组删除:原文不一致说明列表已过期
 * (智能体并发改写),拒删防错删;只删第一处匹配。
 * 实体最后一条 observation 被删时整行移除,并级联清掉指向该实体的
 * relation 行(对齐引擎自身 delete_entities 的级联语义,避免悬空边)。
 */
export function deleteMemoryObservation(
  raw: string,
  entityName: string,
  index: number,
  observation: string
): { next: string } | { error: "not-found" } {
  const lines = raw.split("\n");
  let found = false;
  let entityRemoved = false;
  const rebuilt: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      rebuilt.push(line);
      continue;
    }
    let row: EntityLine;
    try {
      row = JSON.parse(trimmed) as EntityLine;
    } catch {
      rebuilt.push(line);
      continue;
    }
    if (!(!found && isEntityLine(row) && row.name === entityName)) {
      rebuilt.push(line);
      continue;
    }
    if (
      index >= row.observations.length ||
      row.observations[index] !== observation
    ) {
      rebuilt.push(line);
      continue;
    }
    found = true;
    const observations = row.observations.filter((_, i) => i !== index);
    if (observations.length === 0) {
      entityRemoved = true;
      continue;
    }
    rebuilt.push(
      JSON.stringify({
        entityType: row.entityType,
        name: row.name,
        observations,
        type: "entity",
      })
    );
  }
  if (!found) {
    return { error: "not-found" };
  }
  const nextLines = entityRemoved
    ? rebuilt.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return true;
        }
        try {
          const row = JSON.parse(trimmed) as {
            from?: unknown;
            to?: unknown;
            type?: unknown;
          };
          return !(
            row.type === "relation" &&
            (row.from === entityName || row.to === entityName)
          );
        } catch {
          return true;
        }
      })
    : rebuilt;
  const body = nextLines.join("\n");
  if (body.length === 0) {
    return { next: "" };
  }
  const withBreak = raw.endsWith("\n")
    ? `${body.replace(/\n+$/u, "")}\n`
    : body;
  return { next: withBreak };
}

export async function readMemoryList(
  storePath: string
): Promise<MemoryListResult> {
  const info = await stat(storePath).catch(() => null);
  if (!info) {
    return { items: [], tooLarge: false };
  }
  if (info.size > MEMORY_JSONL_MAX_BYTES) {
    return { items: [], tooLarge: true };
  }
  const raw = await readFile(storePath, "utf8");
  return { items: parseMemoryItems(raw), tooLarge: false };
}

export async function writeMemoryJsonl(
  storePath: string,
  raw: string
): Promise<void> {
  await writeFileAtomic(storePath, raw, { mode: 0o600 });
}
