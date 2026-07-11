import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { CachedObservation, FileUsage } from "./local-usage-cache.ts";

function numeric(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return value;
    }
  }
  return 0;
}

function usageRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : null;
}

function tokenVector(record: Record<string, unknown>): string {
  return [
    numeric(record, "input_tokens", "inputTokens"),
    numeric(
      record,
      "cached_input_tokens",
      "cache_read_input_tokens",
      "cachedInputTokens"
    ),
    numeric(record, "output_tokens", "outputTokens"),
    numeric(record, "reasoning_output_tokens", "reasoningTokens"),
    numeric(record, "total_tokens", "totalTokens"),
  ].join(":");
}

export async function scanLocalUsageFile(
  path: string,
  from: string
): Promise<FileUsage> {
  const fileStat = await stat(path);
  let forkedFromId: string | null = null;
  let malformedLines = 0;
  let modelId: string | null = null;
  const modelsSeen = new Set<string>();
  const pendingModelBackfill: Array<{
    cumulativeVector: string | null;
    observation: CachedObservation;
  }> = [];
  let serviceTier: string | undefined;
  const serviceTiersSeen = new Set<string>();
  let sessionId: string | null = null;
  let sawSessionMeta = false;
  let lineNumber = 0;
  let previousTotal: {
    cached: number;
    input: number;
    output: number;
    reasoning: number;
  } | null = null;
  const observations: CachedObservation[] = [];
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: createReadStream(path, { encoding: "utf8" }),
  });
  try {
    for await (const line of lines) {
      lineNumber += 1;
      let event: Record<string, unknown>;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object") continue;
        event = parsed as Record<string, unknown>;
      } catch {
        malformedLines += 1;
        continue;
      }
      const payload = usageRecord(event.payload);
      if (!payload) continue;
      if (event.type === "session_meta" && !sawSessionMeta) {
        sawSessionMeta = true;
        const id = payload.id ?? payload.session_id;
        if (typeof id === "string") sessionId = id;
        const parent = payload.forked_from_id ?? payload.forkedFromId;
        if (typeof parent === "string") forkedFromId = parent;
      }
      if (event.type === "turn_context") {
        const model = payload.model ?? payload.model_id;
        if (typeof model === "string" && model.length > 0) {
          modelId = model;
          modelsSeen.add(model);
        }
        const tier = payload.service_tier ?? payload.serviceTier;
        if (typeof tier === "string" && tier.length > 0) {
          serviceTier = tier;
          serviceTiersSeen.add(tier);
        }
      }
      if (event.type !== "event_msg" || payload.type !== "token_count")
        continue;
      const timestamp =
        typeof event.timestamp === "string" ? event.timestamp : null;
      const date = timestamp?.slice(0, 10);
      if (!date || date < from || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const info = usageRecord(payload.info);
      if (!info) continue;
      const last = usageRecord(info.last_token_usage);
      const total = usageRecord(info.total_token_usage);
      let input = 0;
      let cached = 0;
      let output = 0;
      let reasoning = 0;
      if (last) {
        input = numeric(last, "input_tokens", "inputTokens");
        cached = numeric(
          last,
          "cached_input_tokens",
          "cache_read_input_tokens",
          "cachedInputTokens"
        );
        output = numeric(last, "output_tokens", "outputTokens");
        reasoning = numeric(last, "reasoning_output_tokens", "reasoningTokens");
      } else if (total) {
        const current = {
          cached: numeric(
            total,
            "cached_input_tokens",
            "cache_read_input_tokens",
            "cachedInputTokens"
          ),
          input: numeric(total, "input_tokens", "inputTokens"),
          output: numeric(total, "output_tokens", "outputTokens"),
          reasoning: numeric(
            total,
            "reasoning_output_tokens",
            "reasoningTokens"
          ),
        };
        input = Math.max(0, current.input - (previousTotal?.input ?? 0));
        cached = Math.max(0, current.cached - (previousTotal?.cached ?? 0));
        output = Math.max(0, current.output - (previousTotal?.output ?? 0));
        reasoning = Math.max(
          0,
          current.reasoning - (previousTotal?.reasoning ?? 0)
        );
        previousTotal = current;
      }
      const infoModel = info.model ?? info.model_name;
      if (typeof infoModel === "string" && infoModel.length > 0) {
        modelsSeen.add(infoModel);
      }
      const observedModel =
        modelId ??
        (typeof infoModel === "string" && infoModel.length > 0
          ? infoModel
          : null);
      if (input + output === 0) continue;
      const cumulativeVector = total ? tokenVector(total) : null;
      const observation: CachedObservation = {
        fingerprint: total
          ? `${observedModel ?? ""}:${serviceTier ?? ""}:${cumulativeVector}`
          : `${timestamp ?? ""}:${lineNumber}:${input}:${cached}:${output}:${reasoning}`,
        usage: {
          cachedInputTokens: Math.min(input, cached),
          date,
          inputTokens: input,
          modelId: observedModel,
          outputTokens: output,
          reasoningTokens: reasoning,
          serviceTier: serviceTier ?? null,
        },
      };
      observations.push(observation);
      if (!observedModel) {
        pendingModelBackfill.push({ cumulativeVector, observation });
      }
    }
  } catch {
    malformedLines += 1;
  }
  if (modelsSeen.size === 1) {
    const [onlyModel] = modelsSeen;
    const [onlyServiceTier] = serviceTiersSeen;
    for (const { cumulativeVector, observation } of pendingModelBackfill) {
      observation.usage.modelId = onlyModel ?? null;
      if (serviceTiersSeen.size === 1) {
        observation.usage.serviceTier = onlyServiceTier ?? null;
      }
      if (cumulativeVector) {
        observation.fingerprint = `${onlyModel ?? ""}:${observation.usage.serviceTier ?? ""}:${cumulativeVector}`;
      }
    }
  }
  return {
    forkedFromId,
    malformedLines,
    modifiedAt: fileStat.mtimeMs,
    observations,
    sessionId,
    size: fileStat.size,
  };
}
