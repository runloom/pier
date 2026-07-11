import { createReadStream, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
  UsageDataPublishInput,
  UsageTokenObservation,
} from "@pier/plugin-api/main";

const DAYS = 31;
const MAX_FILES = 5000;

interface FileUsage {
  complete: boolean;
  key: string;
  modifiedAt: number;
  observations: UsageTokenObservation[];
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function jsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    if (files.length >= MAX_FILES) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push(path);
    }
  }
  await visit(root);
  return files;
}

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

async function scanFile(path: string, from: string): Promise<FileUsage> {
  const fileStat = await stat(path);
  let modelId: string | null = null;
  let serviceTier: string | undefined;
  let sessionId: string | null = null;
  let complete = true;
  let previousTotal: {
    cached: number;
    input: number;
    output: number;
    reasoning: number;
  } | null = null;
  const observations: UsageTokenObservation[] = [];
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: createReadStream(path, { encoding: "utf8" }),
  });
  try {
    for await (const line of lines) {
      let event: Record<string, unknown>;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object") continue;
        event = parsed as Record<string, unknown>;
      } catch {
        complete = false;
        continue;
      }
      const payload = usageRecord(event.payload);
      if (!payload) continue;
      if (event.type === "session_meta") {
        const id = payload.id ?? payload.session_id;
        if (typeof id === "string") sessionId = id;
        if (payload.forked_from_id || payload.forkedFromId) complete = false;
      }
      if (event.type === "turn_context") {
        const model = payload.model ?? payload.model_id;
        if (typeof model === "string" && model.length > 0) modelId = model;
        const tier = payload.service_tier ?? payload.serviceTier;
        if (typeof tier === "string" && tier.length > 0) serviceTier = tier;
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
      const observedModel =
        modelId ??
        (typeof infoModel === "string" && infoModel.length > 0
          ? infoModel
          : null);
      if (input + output === 0) continue;
      observations.push({
        cachedInputTokens: Math.min(input, cached),
        date,
        inputTokens: input,
        modelId: observedModel,
        outputTokens: output,
        reasoningTokens: reasoning,
        ...(serviceTier ? { serviceTier } : {}),
      });
    }
  } catch {
    complete = false;
  }
  return {
    complete,
    key: sessionId ?? path,
    modifiedAt: fileStat.mtimeMs,
    observations,
  };
}

function aggregate(
  observations: UsageTokenObservation[]
): UsageTokenObservation[] {
  const rows = new Map<string, UsageTokenObservation>();
  for (const item of observations) {
    const key = `${item.date}\u0000${item.modelId ?? ""}\u0000${item.serviceTier ?? ""}`;
    const row = rows.get(key) ?? {
      cachedInputTokens: 0,
      date: item.date,
      inputTokens: 0,
      modelId: item.modelId,
      outputTokens: 0,
      reasoningTokens: 0,
    };
    row.cachedInputTokens += item.cachedInputTokens;
    row.inputTokens += item.inputTokens;
    row.outputTokens += item.outputTokens;
    row.reasoningTokens =
      (row.reasoningTokens ?? 0) + (item.reasoningTokens ?? 0);
    rows.set(key, row);
  }
  return [...rows.values()];
}

export async function scanLocalCodexUsage(
  codexHome: string
): Promise<UsageDataPublishInput> {
  const from = dateDaysAgo(DAYS - 1);
  const to = new Date().toISOString().slice(0, 10);
  const paths = [
    ...(await jsonlFiles(join(codexHome, "sessions"))),
    ...(await jsonlFiles(join(codexHome, "archived_sessions"))),
  ];
  const scanned: Array<FileUsage | null> = [];
  for (let index = 0; index < paths.length; index += 8) {
    const batch = paths.slice(index, index + 8);
    scanned.push(
      ...(await Promise.all(
        batch.map(async (path) => {
          try {
            return await scanFile(path, from);
          } catch {
            return null;
          }
        })
      ))
    );
  }
  const bySession = new Map<string, FileUsage>();
  let complete = paths.length < MAX_FILES;
  for (const result of scanned) {
    if (!result) {
      complete = false;
      continue;
    }
    complete = complete && result.complete;
    const previous = bySession.get(result.key);
    if (!previous || result.modifiedAt > previous.modifiedAt) {
      bySession.set(result.key, result);
    }
  }
  return {
    coverage: { complete, from, to },
    observations: aggregate(
      [...bySession.values()].flatMap((result) => result.observations)
    ),
    observedAt: Date.now(),
    scope: { kind: "machine" },
    sourceId: "codex-local-sessions",
  };
}
