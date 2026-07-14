import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";

/**
 * 通用增量扫描缓存：`path → (mtime, size, observations)`。
 *
 * Agent collector 用这个持久化上次扫描结果——rescan 时如果文件 mtime + size
 * 未变，直接复用 observation 列表；变了才重新解析。跨会话保留。
 *
 * 文件是每 agent 一个（避免 collector 之间互相污染 key namespace）。
 */

export interface CachedTokenUsage {
  cachedInputTokens: number;
  date: string;
  inputTokens: number;
  modelId: string | null;
  outputTokens: number;
  reasoningTokens: number;
  serviceTier: string | null;
}

export interface CachedObservation {
  fingerprint: string;
  usage: CachedTokenUsage;
}

export interface FileUsage {
  forkedFromId: string | null;
  malformedLines: number;
  modifiedAt: number;
  observations: CachedObservation[];
  sessionId: string | null;
  size: number;
}

const observationSchema = z.object({
  fingerprint: z.string(),
  usage: z.object({
    cachedInputTokens: z.number().int().nonnegative(),
    date: z.string(),
    inputTokens: z.number().int().nonnegative(),
    modelId: z.nullable(z.string()),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    serviceTier: z.nullable(z.string()),
  }),
});

const fileUsageSchema = z.object({
  forkedFromId: z.nullable(z.string()),
  malformedLines: z.number().int().nonnegative(),
  modifiedAt: z.number().nonnegative(),
  observations: z.array(observationSchema),
  sessionId: z.nullable(z.string()),
  size: z.number().int().nonnegative(),
});

const cacheSchema = z.object({
  entries: z.record(z.string(), fileUsageSchema),
  version: z.literal(2),
});

export type LocalUsageCache = z.infer<typeof cacheSchema>;

export async function readLocalUsageCache(
  cachePath: string
): Promise<LocalUsageCache> {
  try {
    return cacheSchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
  } catch {
    return { entries: {}, version: 2 };
  }
}

export async function writeLocalUsageCache(
  cachePath: string,
  entries: Record<string, FileUsage>
): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFileAtomic(
    cachePath,
    JSON.stringify(cacheSchema.parse({ entries, version: 2 })),
    { mode: 0o600 }
  );
}
