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
  epochToDate,
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
 * GitHub Copilot CLI 用量：`~/.copilot/session-state/<id>/events.jsonl`
 * 中 `session.shutdown.data.modelMetrics` 按模型汇总。
 */

export const COPILOT_USAGE_SOURCE_ID = "copilot-local-sessions";

async function safeReadDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function parseEventsFile(
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
      if (stringField(event, "type") !== "session.shutdown") continue;
      const data = asRecord(event.data);
      if (!data) continue;
      const metrics = asRecord(data.modelMetrics);
      if (!metrics) continue;
      const date =
        isoToDate(stringField(event, "timestamp")) ??
        epochToDate(numeric(data.sessionStartTime)) ??
        null;
      if (!date || date < from) continue;
      const eventId = stringField(event, "id") ?? `${path}:${lineNumber}`;
      for (const [modelId, raw] of Object.entries(metrics)) {
        const row = asRecord(raw);
        if (!row) continue;
        const usageBlock = asRecord(row.usage) ?? row;
        const usage = makeObservation({
          cachedInputTokens: numeric(
            usageBlock.cacheReadTokens ?? usageBlock.cachedInputTokens
          ),
          date,
          inputTokens: numeric(usageBlock.inputTokens),
          modelId: modelId || null,
          outputTokens: numeric(usageBlock.outputTokens),
          reasoningTokens: numeric(usageBlock.reasoningTokens),
        });
        if (!usage) continue;
        out.push({
          fingerprint: `${eventId}\u0000${modelId}`,
          usage,
        });
      }
    }
  } catch {
    // skip broken file
  }
  return out;
}

export const createCopilotUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const sessionsRoot = join(
    context.env.HOME ?? homedir(),
    ".copilot",
    "session-state"
  );
  return {
    agentId: "copilot",
    detect: () =>
      existsSync(sessionsRoot) ||
      existsSync(join(context.env.HOME ?? homedir(), ".copilot")),
    sourceId: COPILOT_USAGE_SOURCE_ID,
    async rescan() {
      const { from, to } = coverageWindow();
      const collected: Array<{ fingerprint: string; usage: CachedTokenUsage }> =
        [];
      for (const entry of await safeReadDir(sessionsRoot)) {
        if (!entry.isDirectory()) continue;
        const path = join(sessionsRoot, entry.name, "events.jsonl");
        try {
          const info = await stat(path);
          if (info.mtimeMs < Date.parse(`${from}T00:00:00Z`)) continue;
        } catch {
          continue;
        }
        collected.push(...(await parseEventsFile(path, from)));
      }
      const observations = dedupeByFingerprint(collected);
      if (observations.length === 0) return null;
      return publishInputFromUsages({
        from,
        observations,
        sourceId: COPILOT_USAGE_SOURCE_ID,
        to,
      });
    },
  };
};
