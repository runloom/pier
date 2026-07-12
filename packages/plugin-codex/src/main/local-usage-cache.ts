import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod/mini";

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
    cachedInputTokens: z.number().check(z.int(), z.nonnegative()),
    date: z.string(),
    inputTokens: z.number().check(z.int(), z.nonnegative()),
    modelId: z.nullable(z.string()),
    outputTokens: z.number().check(z.int(), z.nonnegative()),
    reasoningTokens: z.number().check(z.int(), z.nonnegative()),
    serviceTier: z.nullable(z.string()),
  }),
});
const fileUsageSchema = z.object({
  forkedFromId: z.nullable(z.string()),
  malformedLines: z.number().check(z.int(), z.nonnegative()),
  modifiedAt: z.number().check(z.nonnegative()),
  observations: z.array(observationSchema),
  sessionId: z.nullable(z.string()),
  size: z.number().check(z.int(), z.nonnegative()),
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
