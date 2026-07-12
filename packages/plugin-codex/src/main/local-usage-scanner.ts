import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  UsageDataPublishInput,
  UsageTokenObservation,
} from "@pier/plugin-api/main";
import { COST_USAGE_PERIOD_DAYS } from "../shared/constants.ts";
import {
  type CachedTokenUsage,
  type FileUsage,
  readLocalUsageCache,
  writeLocalUsageCache,
} from "./local-usage-cache.ts";
import { scanLocalUsageFile } from "./local-usage-session-parser.ts";

const MAX_FILES = 5000;
const STAT_CONCURRENCY = 32;

export interface UsageCandidate {
  date: string;
  path: string;
}

export interface LocalUsageDiagnostics {
  candidateFiles: number;
  deduplicatedEvents: number;
  failedFiles: number;
  forkedFiles: number;
  malformedLines: number;
  parsedFiles: number;
  reusedFiles: number;
  truncatedFiles: number;
  uniqueEvents: number;
}

export interface LocalUsageScanResult {
  diagnostics: LocalUsageDiagnostics;
  input: UsageDataPublishInput;
}

export interface LocalUsageScanner {
  scan(): Promise<LocalUsageScanResult>;
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function safeReadDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function recentSessionFiles(
  codexHome: string,
  from: string,
  to: string
): Promise<UsageCandidate[]> {
  const files: UsageCandidate[] = [];
  for (const date of datesInRange(from, to)) {
    const dayDir = join(codexHome, "sessions", ...date.split("-"));
    for (const entry of await safeReadDir(dayDir)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push({ date, path: join(dayDir, entry.name) });
      }
    }
  }
  return files;
}

async function recentArchivedFiles(
  codexHome: string,
  from: string,
  to: string
): Promise<UsageCandidate[]> {
  const files: UsageCandidate[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await safeReadDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!(entry.isFile() && entry.name.endsWith(".jsonl"))) continue;
      const date = /rollout-(\d{4}-\d{2}-\d{2})/.exec(entry.name)?.[1];
      if (date && date >= from && date <= to) files.push({ date, path });
    }
  }
  await visit(join(codexHome, "archived_sessions"));
  return files;
}

async function candidateFiles(
  codexHome: string,
  from: string,
  to: string
): Promise<UsageCandidate[]> {
  const paths = await Promise.all([
    recentSessionFiles(codexHome, from, to),
    recentArchivedFiles(codexHome, from, to),
  ]);
  const candidatesByPath = new Map<string, UsageCandidate>();
  for (const candidate of paths.flat()) {
    candidatesByPath.set(candidate.path, candidate);
  }
  return [...candidatesByPath.values()];
}

export function selectRecentCandidatePaths(
  candidates: readonly UsageCandidate[],
  limit: number
): string[] {
  return [...candidates]
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        right.path.localeCompare(left.path)
    )
    .slice(0, limit)
    .map((candidate) => candidate.path);
}

function lineageRoot(
  result: FileUsage,
  parents: ReadonlyMap<string, string>
): string {
  let current = result.forkedFromId ?? result.sessionId;
  if (!current) return "";
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const parent = parents.get(current);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

async function scanLocalUsage(
  codexHome: string,
  cachePath: string
): Promise<LocalUsageScanResult> {
  const from = dateDaysAgo(COST_USAGE_PERIOD_DAYS - 1);
  const to = new Date().toISOString().slice(0, 10);
  const allCandidates = await candidateFiles(codexHome, from, to);
  const paths = selectRecentCandidatePaths(allCandidates, MAX_FILES);
  const cache = await readLocalUsageCache(cachePath);
  const entries: Record<string, FileUsage> = {};
  const diagnostics: LocalUsageDiagnostics = {
    candidateFiles: paths.length,
    deduplicatedEvents: 0,
    failedFiles: 0,
    forkedFiles: 0,
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
          entries[path] = await scanLocalUsageFile(path, from);
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
  diagnostics.forkedFiles = results.filter(
    (result) => result.forkedFromId !== null
  ).length;
  diagnostics.malformedLines = results.reduce(
    (sum, result) => sum + result.malformedLines,
    0
  );
  const parents = new Map<string, string>();
  for (const result of results) {
    if (result.sessionId && result.forkedFromId) {
      parents.set(result.sessionId, result.forkedFromId);
    }
  }
  const uniqueEvents = new Map<string, CachedTokenUsage>();
  for (const result of results) {
    const lineage = lineageRoot(result, parents) || result.sessionId || "file";
    for (const observation of result.observations) {
      const key = `${lineage}\u0000${observation.fingerprint}`;
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
      sourceId: "codex-local-sessions",
    },
  };
}

export function createLocalUsageScanner(options: {
  cachePath: string;
  codexHome: string;
}): LocalUsageScanner {
  let inFlight: Promise<LocalUsageScanResult> | null = null;
  return {
    scan(): Promise<LocalUsageScanResult> {
      if (inFlight) return inFlight;
      inFlight = scanLocalUsage(options.codexHome, options.cachePath).finally(
        () => {
          inFlight = null;
        }
      );
      return inFlight;
    },
  };
}
