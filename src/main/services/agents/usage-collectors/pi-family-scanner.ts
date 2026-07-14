import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  UsageDataPublishInput,
  UsageTokenObservation,
} from "@pier/plugin-api/main";
import { dateDaysAgo, todayDate } from "./date-range.ts";
import {
  type CachedTokenUsage,
  type FileUsage,
  readLocalUsageCache,
  writeLocalUsageCache,
} from "./file-cache.ts";
import { scanPiFamilyUsageFile } from "./pi-family-parser.ts";

/**
 * pi / omp 家族 scanner。它们共享同一 JSONL 格式（omp 是 pi 的 fork），只
 * 是 sessions root 不同（`~/.pi/agent/sessions` / `~/.omp/agent/sessions`）。
 *
 * 递归罗列候选文件 → mtime 首过滤 → parser 抽 assistant.usage → 跨文件用
 * sessionId × fingerprint 去重。跟 Claude Code scanner 结构对齐；同一 mtime
 * 剪枝策略。
 */

const PI_FAMILY_USAGE_PERIOD_DAYS = 31;
const MAX_FILES = 5000;
const STAT_CONCURRENCY = 32;

interface UsageCandidate {
  mtime: number;
  path: string;
}

export interface PiFamilyUsageDiagnostics {
  candidateFiles: number;
  deduplicatedEvents: number;
  failedFiles: number;
  malformedLines: number;
  parsedFiles: number;
  reusedFiles: number;
  truncatedFiles: number;
  uniqueEvents: number;
}

export interface PiFamilyUsageScanResult {
  diagnostics: PiFamilyUsageDiagnostics;
  input: UsageDataPublishInput;
}

async function safeReadDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function candidateFiles(
  sessionsRoot: string,
  fromEpochMs: number
): Promise<UsageCandidate[]> {
  const found: UsageCandidate[] = [];
  for (const dirEntry of await safeReadDir(sessionsRoot)) {
    if (!dirEntry.isDirectory()) continue;
    const cwdEncodedDir = join(sessionsRoot, dirEntry.name);
    for (const fileEntry of await safeReadDir(cwdEncodedDir)) {
      if (!(fileEntry.isFile() && fileEntry.name.endsWith(".jsonl"))) continue;
      const path = join(cwdEncodedDir, fileEntry.name);
      try {
        const info = await stat(path);
        if (info.mtimeMs >= fromEpochMs) {
          found.push({ mtime: info.mtimeMs, path });
        }
      } catch {
        // stat 失败跳过
      }
    }
  }
  return found;
}

export function selectRecentCandidatePaths(
  candidates: readonly UsageCandidate[],
  limit: number
): string[] {
  return [...candidates]
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, limit)
    .map((candidate) => candidate.path);
}

async function scanPiFamilyUsage(
  sessionsRoot: string,
  cachePath: string,
  sourceId: string
): Promise<PiFamilyUsageScanResult> {
  const from = dateDaysAgo(PI_FAMILY_USAGE_PERIOD_DAYS - 1);
  const to = todayDate();
  const fromEpochMs = new Date(`${from}T00:00:00Z`).getTime();
  const allCandidates = await candidateFiles(sessionsRoot, fromEpochMs);
  const paths = selectRecentCandidatePaths(allCandidates, MAX_FILES);
  const cache = await readLocalUsageCache(cachePath);
  const entries: Record<string, FileUsage> = {};
  const diagnostics: PiFamilyUsageDiagnostics = {
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
          entries[path] = await scanPiFamilyUsageFile(path, from);
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
    // parentSession（forkedFromId）指向 lineage 根；缺失时降级到 sessionId。
    const scope = result.forkedFromId ?? result.sessionId ?? "file";
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
  diagnostics.uniqueEvents = uniqueEvents.size;
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
      observations: [...uniqueEvents.values()].map(
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
      sourceId,
    },
  };
}

export interface PiFamilyUsageScanner {
  scan(): Promise<PiFamilyUsageScanResult>;
}

export function createPiFamilyUsageScanner(options: {
  cachePath: string;
  sessionsRoot: string;
  sourceId: string;
}): PiFamilyUsageScanner {
  let inFlight: Promise<PiFamilyUsageScanResult> | null = null;
  return {
    scan(): Promise<PiFamilyUsageScanResult> {
      if (inFlight) return inFlight;
      inFlight = scanPiFamilyUsage(
        options.sessionsRoot,
        options.cachePath,
        options.sourceId
      ).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
