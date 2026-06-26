import { randomUUID } from "node:crypto";
import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal-launch.ts";

export interface TerminalLaunchRegistry {
  consume(launchId: string): ResolvedTerminalLaunchOptions | null;
  discard(launchId: string): void;
  read(launchId: string): ResolvedTerminalLaunchOptions | null;
  register(launch: ResolvedTerminalLaunchOptions): string;
  sweepExpired(): number;
}

export interface CreateTerminalLaunchRegistryOptions {
  createId?: () => string;
  now?: () => number;
  ttlMs?: number;
}

interface TerminalLaunchEntry {
  createdAt: number;
  launch: ResolvedTerminalLaunchOptions;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function createTerminalLaunchRegistry(
  optionsOrCreateId: CreateTerminalLaunchRegistryOptions | (() => string) = {}
): TerminalLaunchRegistry {
  const options =
    typeof optionsOrCreateId === "function"
      ? { createId: optionsOrCreateId }
      : optionsOrCreateId;
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const launches = new Map<string, TerminalLaunchEntry>();

  function sweepExpired(): number {
    const current = now();
    let removed = 0;
    for (const [launchId, entry] of launches) {
      if (current - entry.createdAt > ttlMs) {
        launches.delete(launchId);
        removed++;
      }
    }
    return removed;
  }

  return {
    consume(launchId) {
      sweepExpired();
      const launch = launches.get(launchId)?.launch ?? null;
      launches.delete(launchId);
      return launch;
    },
    discard(launchId) {
      launches.delete(launchId);
    },
    read(launchId) {
      sweepExpired();
      return launches.get(launchId)?.launch ?? null;
    },
    register(launch) {
      sweepExpired();
      const launchId = createId();
      launches.set(launchId, { createdAt: now(), launch });
      return launchId;
    },
    sweepExpired,
  };
}

export const terminalLaunchRegistry = createTerminalLaunchRegistry();
