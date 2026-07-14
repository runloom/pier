import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  UsageDataPublishInput,
  UsageTokenObservation,
} from "@pier/plugin-api/main";
import { scanClaudeCodeUsageFile } from "./claude-code-parser.ts";
import { dateDaysAgo, todayDate } from "./date-range.ts";
import {
  type CachedTokenUsage,
  type FileUsage,
  readLocalUsageCache,
  writeLocalUsageCache,
} from "./file-cache.ts";

/**
 * Claude Code CLI usage scanner。数据源：`~/.claude/projects/<slug>/*.jsonl`。
 * 与 Codex 结构差异见 `claude-code-parser.ts`；本模块只负责：
 * - 递归罗列候选文件（不限日期目录，Claude Code 不按日期分片，需要看文件 mtime）
 * - 增量缓存（未变文件跳过重解析）
 * - 跨文件用 `sessionId × message.id` 去重
 */

const CLAUDE_CODE_USAGE_PERIOD_DAYS = 31;
const MAX_FILES = 5000;
const STAT_CONCURRENCY = 32;

export const CLAUDE_CODE_USAGE_SOURCE_ID = "claude-code-local-sessions";

interface UsageCandidate {
  mtime: number;
  path: string;
}

export interface ClaudeCodeUsageDiagnostics {
  candidateFiles: number;
  deduplicatedEvents: number;
  failedFiles: number;
  malformedLines: number;
  parsedFiles: number;
  reusedFiles: number;
  truncatedFiles: number;
  uniqueEvents: number;
}

export interface ClaudeCodeUsageScanResult {
  diagnostics: ClaudeCodeUsageDiagnostics;
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
  projectsRoot: string,
  fromEpochMs: number
): Promise<UsageCandidate[]> {
  const found: UsageCandidate[] = [];
  for (const projectEntry of await safeReadDir(projectsRoot)) {
    if (!projectEntry.isDirectory()) continue;
    const projectDir = join(projectsRoot, projectEntry.name);
    for (const fileEntry of await safeReadDir(projectDir)) {
      if (!(fileEntry.isFile() && fileEntry.name.endsWith(".jsonl"))) continue;
      const path = join(projectDir, fileEntry.name);
      try {
        const info = await stat(path);
        // mtime 是首过滤——比日期目录分片粗但足够剪枝无关会话。
        // 精细日期过滤在 parser 里按 timestamp 做（低于 from 的 usage 行会被丢）。
        if (info.mtimeMs >= fromEpochMs) {
          found.push({ mtime: info.mtimeMs, path });
        }
      } catch {
        // stat 失败的文件跳过——不当致命
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

async function scanClaudeCodeUsage(
  claudeProjectsRoot: string,
  cachePath: string
): Promise<ClaudeCodeUsageScanResult> {
  const from = dateDaysAgo(CLAUDE_CODE_USAGE_PERIOD_DAYS - 1);
  const to = todayDate();
  const fromEpochMs = new Date(`${from}T00:00:00Z`).getTime();
  const allCandidates = await candidateFiles(claudeProjectsRoot, fromEpochMs);
  const paths = selectRecentCandidatePaths(allCandidates, MAX_FILES);
  const cache = await readLocalUsageCache(cachePath);
  const entries: Record<string, FileUsage> = {};
  const diagnostics: ClaudeCodeUsageDiagnostics = {
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
          entries[path] = await scanClaudeCodeUsageFile(path, from);
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
    // Claude Code 无 fork 血统；直接 sessionId × fingerprint 作 key。
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
      sourceId: CLAUDE_CODE_USAGE_SOURCE_ID,
    },
  };
}

export interface ClaudeCodeUsageScanner {
  scan(): Promise<ClaudeCodeUsageScanResult>;
}

export function createClaudeCodeUsageScanner(options: {
  cachePath: string;
  claudeProjectsRoot: string;
}): ClaudeCodeUsageScanner {
  let inFlight: Promise<ClaudeCodeUsageScanResult> | null = null;
  return {
    scan(): Promise<ClaudeCodeUsageScanResult> {
      if (inFlight) return inFlight;
      inFlight = scanClaudeCodeUsage(
        options.claudeProjectsRoot,
        options.cachePath
      ).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
