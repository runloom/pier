import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  UsageDataPublishInput,
  UsageTokenObservation,
} from "@pier/plugin-api/main";
import { dateDaysAgo, filterByCoverageDate, todayDate } from "./date-range.ts";
import {
  type CachedTokenUsage,
  type FileUsage,
  readLocalUsageCache,
  writeLocalUsageCache,
} from "./file-cache.ts";
import { scanKimiUsageFile } from "./kimi-parser.ts";

/**
 * Kimi CLI / Kimi Code CLI usage scanner。
 *
 * 多 root：`~/.kimi/sessions` + `~/.kimi-code/sessions`（及 env 覆盖）。
 * 递归找 `wire.jsonl`，mtime 过滤后解析 StatusUpdate.token_usage。
 */

const KIMI_USAGE_PERIOD_DAYS = 31;
const MAX_FILES = 5000;
const STAT_CONCURRENCY = 32;

export const KIMI_USAGE_SOURCE_ID = "kimi-local-sessions";

interface UsageCandidate {
  mtime: number;
  path: string;
}

export interface KimiUsageDiagnostics {
  candidateFiles: number;
  deduplicatedEvents: number;
  failedFiles: number;
  malformedLines: number;
  parsedFiles: number;
  reusedFiles: number;
  truncatedFiles: number;
  uniqueEvents: number;
}

export interface KimiUsageScanResult {
  diagnostics: KimiUsageDiagnostics;
  input: UsageDataPublishInput;
}

async function safeReadDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * 从 config.toml 抽 `default_model = "..."`；`kimi-code/k3` → `k3`。
 * 解析失败返回 null（观测仍入库，定价可能 unpriced）。
 */
export function parseKimiDefaultModel(toml: string): string | null {
  const match = /(?:^|\n)\s*default_model\s*=\s*"([^"]+)"/.exec(toml);
  if (!match?.[1]) return null;
  const raw = match[1].trim();
  if (raw.length === 0) return null;
  const slash = raw.lastIndexOf("/");
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}

export async function resolveKimiDefaultModel(
  configPaths: readonly string[]
): Promise<string | null> {
  for (const path of configPaths) {
    try {
      const text = await readFile(path, "utf8");
      const model = parseKimiDefaultModel(text);
      if (model) return model;
    } catch {
      // try next
    }
  }
  return null;
}

async function collectWireFiles(
  dir: string,
  fromEpochMs: number,
  found: UsageCandidate[]
): Promise<void> {
  for (const entry of await safeReadDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectWireFiles(path, fromEpochMs, found);
      continue;
    }
    if (!(entry.isFile() && entry.name === "wire.jsonl")) continue;
    try {
      const info = await stat(path);
      if (info.mtimeMs >= fromEpochMs) {
        found.push({ mtime: info.mtimeMs, path });
      }
    } catch {
      // skip
    }
  }
}

async function candidateFiles(
  sessionsRoots: readonly string[],
  fromEpochMs: number
): Promise<UsageCandidate[]> {
  const found: UsageCandidate[] = [];
  for (const root of sessionsRoots) {
    await collectWireFiles(root, fromEpochMs, found);
  }
  return found;
}

export function selectRecentKimiCandidatePaths(
  candidates: readonly UsageCandidate[],
  limit: number
): string[] {
  return [...candidates]
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, limit)
    .map((candidate) => candidate.path);
}

async function scanKimiUsage(
  sessionsRoots: readonly string[],
  configPaths: readonly string[],
  cachePath: string
): Promise<KimiUsageScanResult> {
  const from = dateDaysAgo(KIMI_USAGE_PERIOD_DAYS - 1);
  const to = todayDate();
  const fromEpochMs = new Date(`${from}T00:00:00Z`).getTime();
  const defaultModelId = await resolveKimiDefaultModel(configPaths);
  const allCandidates = await candidateFiles(sessionsRoots, fromEpochMs);
  const paths = selectRecentKimiCandidatePaths(allCandidates, MAX_FILES);
  const cache = await readLocalUsageCache(cachePath);
  const entries: Record<string, FileUsage> = {};
  const diagnostics: KimiUsageDiagnostics = {
    candidateFiles: paths.length,
    deduplicatedEvents: 0,
    failedFiles: 0,
    malformedLines: 0,
    parsedFiles: 0,
    reusedFiles: 0,
    truncatedFiles: Math.max(0, allCandidates.length - paths.length),
    uniqueEvents: 0,
  };

  for (let index = 0; index < paths.length; index += STAT_CONCURRENCY) {
    const batch = paths.slice(index, index + STAT_CONCURRENCY);
    await Promise.all(
      batch.map(async (path) => {
        try {
          const fileStat = await stat(path);
          const cached = cache.entries[path];
          if (
            cached &&
            cached.modifiedAt === fileStat.mtimeMs &&
            cached.size === fileStat.size
          ) {
            entries[path] = cached;
            diagnostics.reusedFiles += 1;
            return;
          }
          entries[path] = await scanKimiUsageFile(path, from, defaultModelId);
          diagnostics.parsedFiles += 1;
        } catch {
          diagnostics.failedFiles += 1;
          const cached = cache.entries[path];
          if (cached) entries[path] = cached;
        }
      })
    );
  }

  const results = paths.flatMap((path) =>
    entries[path] ? [entries[path]] : []
  );
  diagnostics.malformedLines = results.reduce(
    (sum, result) => sum + result.malformedLines,
    0
  );
  const uniqueEvents = new Map<string, CachedTokenUsage>();
  for (const result of results) {
    const scope = result.sessionId ?? "file";
    for (const observation of result.observations) {
      const key = `${scope}\u0000${observation.fingerprint}`;
      const previous = uniqueEvents.get(key);
      if (previous) {
        diagnostics.deduplicatedEvents += 1;
        if (observation.usage.date < previous.date) {
          uniqueEvents.set(key, observation.usage);
        }
      } else {
        uniqueEvents.set(key, observation.usage);
      }
    }
  }
  const observations = filterByCoverageDate(
    [...uniqueEvents.values()],
    from,
    to
  );
  diagnostics.uniqueEvents = observations.length;
  await writeLocalUsageCache(cachePath, entries);
  return {
    diagnostics,
    input: {
      coverage: {
        complete:
          diagnostics.failedFiles === 0 &&
          diagnostics.malformedLines === 0 &&
          diagnostics.truncatedFiles === 0,
        from,
        to,
      },
      observations: observations.map(
        (observation): UsageTokenObservation => ({
          cachedInputTokens: observation.cachedInputTokens,
          date: observation.date,
          inputTokens: observation.inputTokens,
          modelId: observation.modelId,
          outputTokens: observation.outputTokens,
          reasoningTokens: observation.reasoningTokens,
          ...(observation.serviceTier
            ? { serviceTier: observation.serviceTier }
            : {}),
        })
      ),
      observedAt: Date.now(),
      scope: { kind: "machine" },
      sourceId: KIMI_USAGE_SOURCE_ID,
    },
  };
}

export interface KimiUsageScanner {
  scan(): Promise<KimiUsageScanResult>;
}

export function createKimiUsageScanner(options: {
  cachePath: string;
  configPaths: readonly string[];
  sessionsRoots: readonly string[];
}): KimiUsageScanner {
  let inFlight: Promise<KimiUsageScanResult> | null = null;
  return {
    scan(): Promise<KimiUsageScanResult> {
      if (inFlight) return inFlight;
      inFlight = scanKimiUsage(
        options.sessionsRoots,
        options.configPaths,
        options.cachePath
      ).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
