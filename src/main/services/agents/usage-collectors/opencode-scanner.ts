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
import { scanOpenCodeUsageFile } from "./opencode-parser.ts";

/**
 * OpenCode usage scanner。数据源：`<opencodeDataDir>/storage/session/message/**\/*.json`
 * （JSON storage 布局，v1.2.0 之前版本）。v1.2.0+ 的 SQLite 存储由
 * `opencode-sqlite-scanner.ts` 处理；`opencode.ts` collector 会同时消费两侧
 * 结果并去重合并。
 *
 * 与 Codex / Claude Code / Pi 家 scanner 结构一致，唯一差异：每个候选文件
 * 是一个"单消息 JSON"，parser 读整文件后返回单条 observation。
 */

const OPENCODE_USAGE_PERIOD_DAYS = 31;
const MAX_FILES = 20_000; // 一 message 一文件；量比 jsonl 家族大。
const STAT_CONCURRENCY = 48;

export const OPENCODE_USAGE_SOURCE_ID = "opencode-local-sessions";

interface UsageCandidate {
  mtime: number;
  path: string;
}

export interface OpenCodeUsageDiagnostics {
  candidateFiles: number;
  deduplicatedEvents: number;
  failedFiles: number;
  malformedLines: number;
  parsedFiles: number;
  reusedFiles: number;
  truncatedFiles: number;
  uniqueEvents: number;
}

export interface OpenCodeUsageScanResult {
  diagnostics: OpenCodeUsageDiagnostics;
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
  messageRoot: string,
  fromEpochMs: number
): Promise<UsageCandidate[]> {
  const found: UsageCandidate[] = [];
  // Layout: <messageRoot>/<sessionID>/<messageID>.json
  for (const sessionEntry of await safeReadDir(messageRoot)) {
    if (!sessionEntry.isDirectory()) continue;
    const sessionDir = join(messageRoot, sessionEntry.name);
    for (const fileEntry of await safeReadDir(sessionDir)) {
      if (!(fileEntry.isFile() && fileEntry.name.endsWith(".json"))) continue;
      const path = join(sessionDir, fileEntry.name);
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

async function scanOpenCodeUsage(
  messageRoot: string,
  cachePath: string
): Promise<OpenCodeUsageScanResult> {
  const from = dateDaysAgo(OPENCODE_USAGE_PERIOD_DAYS - 1);
  const to = todayDate();
  const fromEpochMs = new Date(`${from}T00:00:00Z`).getTime();
  const allCandidates = await candidateFiles(messageRoot, fromEpochMs);
  const paths = selectRecentCandidatePaths(allCandidates, MAX_FILES);
  const cache = await readLocalUsageCache(cachePath);
  const entries: Record<string, FileUsage> = {};
  const diagnostics: OpenCodeUsageDiagnostics = {
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
          entries[path] = await scanOpenCodeUsageFile(path, fromEpochMs);
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
  const uniqueEvents = new Map<
    string,
    { eventId: string; usage: CachedTokenUsage }
  >();
  for (const result of results) {
    const scope = result.sessionId ?? "file";
    for (const observation of result.observations) {
      const key = `${scope}\u0000${observation.fingerprint}`;
      const previous = uniqueEvents.get(key);
      if (previous) {
        diagnostics.deduplicatedEvents += 1;
        if (observation.usage.date < previous.usage.date) {
          uniqueEvents.set(key, {
            eventId: observation.fingerprint,
            usage: observation.usage,
          });
        }
      } else {
        uniqueEvents.set(key, {
          eventId: observation.fingerprint,
          usage: observation.usage,
        });
      }
    }
  }
  const observations = filterByCoverageDate(
    [...uniqueEvents.values()].map(({ eventId, usage }) => ({
      eventId,
      usage,
      date: usage.date,
    })),
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
        ({ eventId, usage }): UsageTokenObservation => ({
          cachedInputTokens: usage.cachedInputTokens,
          date: usage.date,
          eventId,
          inputTokens: usage.inputTokens,
          modelId: usage.modelId,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          ...(usage.serviceTier ? { serviceTier: usage.serviceTier } : {}),
        })
      ),
      observedAt: Date.now(),
      scope: { kind: "machine" },
      sourceId: OPENCODE_USAGE_SOURCE_ID,
    },
  };
}

export interface OpenCodeUsageScanner {
  scan(): Promise<OpenCodeUsageScanResult>;
}

export function createOpenCodeUsageScanner(options: {
  cachePath: string;
  messageRoot: string;
}): OpenCodeUsageScanner {
  let inFlight: Promise<OpenCodeUsageScanResult> | null = null;
  return {
    scan(): Promise<OpenCodeUsageScanResult> {
      if (inFlight) return inFlight;
      inFlight = scanOpenCodeUsage(
        options.messageRoot,
        options.cachePath
      ).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
