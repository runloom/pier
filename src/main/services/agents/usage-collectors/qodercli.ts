import { createReadStream, type Dirent, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { CachedTokenUsage } from "./file-cache.ts";
import {
  asRecord,
  coverageWindow,
  dedupeByFingerprint,
  isoToDate,
  makeObservation,
  numeric,
  publishInputFromUsages,
  stringField,
} from "./observation-utils.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * Qoder CLI 用量：`~/.qoder/logs/sessions/.../segments/*.jsonl` 中
 * `model.response.completed` 的 input/output/cache tokens。
 */

export const QODERCLI_USAGE_SOURCE_ID = "qodercli-local-sessions";

async function safeReadDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function collectSegmentFiles(
  dir: string,
  fromEpochMs: number,
  out: string[]
): Promise<void> {
  for (const entry of await safeReadDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSegmentFiles(path, fromEpochMs, out);
      continue;
    }
    if (!(entry.isFile() && entry.name.endsWith(".jsonl"))) continue;
    try {
      const info = await stat(path);
      if (info.mtimeMs >= fromEpochMs) out.push(path);
    } catch {
      // skip
    }
  }
}

async function parseSegment(
  path: string,
  from: string
): Promise<Array<{ fingerprint: string; usage: CachedTokenUsage }>> {
  const out: Array<{ fingerprint: string; usage: CachedTokenUsage }> = [];
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: createReadStream(path, { encoding: "utf8" }),
  });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      let event: Record<string, unknown>;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object") continue;
        event = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      if (stringField(event, "type") !== "model.response.completed") continue;
      const data = asRecord(event.data);
      if (!data) continue;
      const date = isoToDate(stringField(event, "ts"));
      if (!date || date < from) continue;
      const cacheRead = numeric(
        data.cache_read_input_tokens ?? data.cacheReadInputTokens
      );
      const cacheWrite = numeric(
        data.cache_creation_input_tokens ?? data.cacheCreationInputTokens
      );
      const rawInput = numeric(data.input_tokens ?? data.inputTokens);
      const usage = makeObservation({
        cachedInputTokens: cacheRead,
        date,
        inputTokens: rawInput + cacheRead + cacheWrite,
        modelId: stringField(data, "model"),
        outputTokens: numeric(data.output_tokens ?? data.outputTokens),
      });
      if (!usage) continue;
      const fingerprint =
        stringField(event, "request_id", "turn_id") ?? `${path}:${lineNumber}`;
      out.push({ fingerprint, usage });
    }
  } catch {
    // skip
  }
  return out;
}

export const createQodercliUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const logsRoot = join(
    context.env.HOME ?? homedir(),
    ".qoder",
    "logs",
    "sessions"
  );
  return {
    agentId: "qodercli",
    detect: () =>
      existsSync(logsRoot) ||
      existsSync(join(context.env.HOME ?? homedir(), ".qoder")),
    sourceId: QODERCLI_USAGE_SOURCE_ID,
    async rescan() {
      const { from, to } = coverageWindow();
      const fromEpochMs = Date.parse(`${from}T00:00:00Z`);
      const files: string[] = [];
      await collectSegmentFiles(logsRoot, fromEpochMs, files);
      const collected: Array<{ fingerprint: string; usage: CachedTokenUsage }> =
        [];
      // 大体积日志：最多扫 2000 个 segment，优先最近 mtime 的由 collect 不排序——补排序
      files.sort();
      const capped = files.slice(-2000);
      for (const path of capped) {
        collected.push(...(await parseSegment(path, from)));
      }
      const observations = dedupeByFingerprint(collected);
      if (observations.length === 0) return null;
      return publishInputFromUsages({
        complete: files.length <= 2000,
        from,
        observations,
        sourceId: QODERCLI_USAGE_SOURCE_ID,
        to,
      });
    },
  };
};
