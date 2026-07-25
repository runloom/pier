import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
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
import { scanGrokUsageFile } from "./grok-parser.ts";

/**
 * Grok Build CLI usage scanner。
 * 数据源：`<GROK_HOME|~/.grok>/sessions/<encoded-cwd>/<sessionId>/updates.jsonl`
 */

const GROK_USAGE_PERIOD_DAYS = 31;
const MAX_FILES = 5000;
const STAT_CONCURRENCY = 32;

export const GROK_USAGE_SOURCE_ID = "grok-local-sessions";

interface UsageCandidate {
  mtime: number;
  path: string;
}

export interface GrokUsageDiagnostics {
  candidateFiles: number;
  deduplicatedEvents: number;
  failedFiles: number;
  malformedLines: number;
  parsedFiles: number;
  reusedFiles: number;
  truncatedFiles: number;
  uniqueEvents: number;
}

export interface GrokUsageScanResult {
  diagnostics: GrokUsageDiagnostics;
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
  for (const cwdEntry of await safeReadDir(sessionsRoot)) {
    if (!cwdEntry.isDirectory()) continue;
    const cwdDir = join(sessionsRoot, cwdEntry.name);
    for (const sessionEntry of await safeReadDir(cwdDir)) {
      if (!sessionEntry.isDirectory()) continue;
      const path = join(cwdDir, sessionEntry.name, "updates.jsonl");
      try {
        const info = await stat(path);
        if (info.mtimeMs >= fromEpochMs) {
          found.push({ mtime: info.mtimeMs, path });
        }
      } catch {
        // 无 updates.jsonl 的空会话跳过
      }
    }
  }
  return found;
}

export function selectRecentGrokCandidatePaths(
  candidates: readonly UsageCandidate[],
  limit: number
): string[] {
  return [...candidates]
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, limit)
    .map((candidate) => candidate.path);
}

async function scanGrokUsage(
  sessionsRoot: string,
  cachePath: string
): Promise<GrokUsageScanResult> {
  const from = dateDaysAgo(GROK_USAGE_PERIOD_DAYS - 1);
  const to = todayDate();
  const fromEpochMs = new Date(`${from}T00:00:00Z`).getTime();
  const allCandidates = await candidateFiles(sessionsRoot, fromEpochMs);
  const paths = selectRecentGrokCandidatePaths(allCandidates, MAX_FILES);
  const cache = await readLocalUsageCache(cachePath);
  const entries: Record<string, FileUsage> = {};
  const diagnostics: GrokUsageDiagnostics = {
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
          entries[path] = await scanGrokUsageFile(path, from);
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
      sourceId: GROK_USAGE_SOURCE_ID,
    },
  };
}

export interface GrokUsageScanner {
  scan(): Promise<GrokUsageScanResult>;
}

export function createGrokUsageScanner(options: {
  cachePath: string;
  sessionsRoot: string;
}): GrokUsageScanner {
  let inFlight: Promise<GrokUsageScanResult> | null = null;
  return {
    scan(): Promise<GrokUsageScanResult> {
      if (inFlight) return inFlight;
      inFlight = scanGrokUsage(options.sessionsRoot, options.cachePath).finally(
        () => {
          inFlight = null;
        }
      );
      return inFlight;
    },
  };
}
