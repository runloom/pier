import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { StableProjectIdentity } from "./identity.ts";
import {
  attemptFileName,
  type PendingLaunchAttempt,
} from "./launch-gate-types.ts";
import type { createProjectSkillsPaths } from "./paths.ts";

/**
 * Durable launch-attempt persistence (design v8 §5.2 SPAWN_INTENT
 * at-most-once machinery), split from launch-gate.ts (file-size cap).
 * Behavior unchanged.
 */

export class EnsureReadyTimeout extends Error {
  constructor() {
    super("ensureReady timed out");
    this.name = "EnsureReadyTimeout";
  }
}

/** Race a promise against a deadline; the loser's result is discarded. */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new EnsureReadyTimeout());
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error as Error);
      }
    );
  });
}

/** Durable attempt files older than this are diagnostics no one will read. */
const ATTEMPT_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface LaunchAttemptStore {
  loadDurableAttempt(
    projectIdentity: StableProjectIdentity,
    launchAttemptId: string
  ): Promise<PendingLaunchAttempt | null>;
  persistAttempt(record: PendingLaunchAttempt): Promise<void>;
  /** Best-effort GC of stale durable attempt diagnostics (once per root). */
  sweepAttemptFiles(rootKey: string): Promise<void>;
}

export function createLaunchAttemptStore(options: {
  paths: ReturnType<typeof createProjectSkillsPaths>;
  now: () => number;
}): LaunchAttemptStore {
  const { paths, now } = options;
  const sweptAttemptDirs = new Set<string>();

  function attemptsDir(rootKey: string): string {
    return join(paths.projectDir(rootKey), "launch-attempts");
  }

  function attemptPath(rootKey: string, launchAttemptId: string): string {
    return join(
      attemptsDir(rootKey),
      `${attemptFileName(launchAttemptId)}.json`
    );
  }

  return {
    async sweepAttemptFiles(rootKey) {
      if (sweptAttemptDirs.has(rootKey)) return;
      sweptAttemptDirs.add(rootKey);
      const dir = attemptsDir(rootKey);
      try {
        const entries = await readdir(dir);
        const cutoff = now() - ATTEMPT_FILE_MAX_AGE_MS;
        for (const entry of entries) {
          if (!entry.endsWith(".json")) continue;
          const filePath = join(dir, entry);
          try {
            const info = await stat(filePath);
            if (info.mtimeMs < cutoff) {
              await unlink(filePath);
            }
          } catch {
            // Skip unreadable entries; diagnostics only.
          }
        }
      } catch {
        // Directory absent — nothing to sweep.
      }
    },

    async persistAttempt(record) {
      const rootKey = paths.rootKeyFor(record.projectIdentity);
      const dir = attemptsDir(rootKey);
      await mkdir(dir, { recursive: true });
      await writeFileAtomic(
        attemptPath(rootKey, record.launchAttemptId),
        `${JSON.stringify(record, null, 2)}\n`,
        "utf8"
      );
    },

    async loadDurableAttempt(projectIdentity, launchAttemptId) {
      const rootKey = paths.rootKeyFor(projectIdentity);
      try {
        const raw = await readFile(
          attemptPath(rootKey, launchAttemptId),
          "utf8"
        );
        return JSON.parse(raw) as PendingLaunchAttempt;
      } catch {
        return null;
      }
    },
  };
}
