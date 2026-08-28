import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  type CanvasTrustStatus,
  type CanvasTrustStore,
  canvasTrustStoreSchema,
  emptyCanvasTrustStore,
} from "@shared/contracts/live-modules.ts";
import { normalizeProjectRootKey } from "@shared/live-module-canvas-path.ts";
import { debouncedJsonStore } from "../../state/debounced-store.ts";
import { createCanvasCommandGrantService } from "./command-grants.ts";

/**
 * Canvas project trust service (画布项目信任门).
 *
 * Persists first-open trust decisions per project root in userData — never
 * inside the project, because in-repo files are exactly what the gate protects
 * against (a hostile repo could pre-seed an in-project trust mark).
 * pier-home canvases are Pier-owned local content and are not gated here.
 */

export interface CanvasTrustService {
  commandGrantMatches(input: {
    canvasPath: string;
    commandHash: string;
    key: string;
    projectRootPath: string;
  }): Promise<boolean>;
  flush(): Promise<void>;
  /** Record an explicit trust decision for the project root. */
  grant(projectRootPath: string): Promise<void>;
  rememberCommandGrant(input: {
    canvasPath: string;
    commandHash: string;
    key: string;
    projectRootPath: string;
  }): Promise<void>;
  /** Drop the stored decision; the next preview asks again. */
  revoke(projectRootPath: string): Promise<void>;
  status(projectRootPath: string): Promise<CanvasTrustStatus>;
}

export function canvasTrustStorePath(userDataDir: string): string {
  return join(userDataDir, "canvas-trust.json");
}

/**
 * Trust keys must match compile-time `realpath` roots (`/tmp` vs `/private/tmp`).
 * Unresolvable paths fail closed (null).
 */
export async function canonicalizeProjectRootKey(
  projectRootPath: string
): Promise<string | null> {
  const trimmed = projectRootPath.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const key = normalizeProjectRootKey(await realpath(trimmed));
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** Flush hook registered by the app's service instance (quit-time durability). */
let activeFlush: (() => Promise<void>) | null = null;

/** Called by window close preparation; no-op before the service is created. */
export function flushCanvasTrustState(): Promise<void> {
  return activeFlush ? activeFlush() : Promise.resolve();
}

export function createCanvasTrustService(options: {
  userDataDir: string;
  now?: () => Date;
}): CanvasTrustService {
  const now = options.now ?? (() => new Date());
  const store = debouncedJsonStore<CanvasTrustStore>({
    defaults: emptyCanvasTrustStore(),
    filePath: canvasTrustStorePath(options.userDataDir),
  });

  const ensureStore = async (): Promise<CanvasTrustStore> => {
    const loaded = await store.init();
    const parsed = canvasTrustStoreSchema.safeParse(loaded);
    if (parsed.success) {
      return parsed.data;
    }
    // Invalid document must be replaced so a later grant can persist.
    return store.replace(emptyCanvasTrustStore());
  };

  const grants = createCanvasCommandGrantService({
    canonicalizeProjectRootKey,
    userDataDir: options.userDataDir,
    ...(options.now ? { now: options.now } : {}),
  });

  const service: CanvasTrustService = {
    commandGrantMatches: (input) => grants.matches(input),
    rememberCommandGrant: (input) => grants.remember(input),
    async grant(projectRootPath) {
      await ensureStore();
      const key = await canonicalizeProjectRootKey(projectRootPath);
      if (!key) {
        throw new Error("canvas trust: project root could not be resolved");
      }
      store.mutate((current) => ({
        ...current,
        roots: {
          ...current.roots,
          [key]: { grantedAt: now().toISOString() },
        },
      }));
    },

    async revoke(projectRootPath) {
      const state = await ensureStore();
      const key = await canonicalizeProjectRootKey(projectRootPath);
      if (!(key && state.roots[key])) {
        return;
      }
      store.mutate((current) => {
        const roots = { ...current.roots };
        delete roots[key];
        return { ...current, roots };
      });
    },

    async status(projectRootPath) {
      const state = await ensureStore();
      const key = await canonicalizeProjectRootKey(projectRootPath);
      if (!key) {
        return { grantedAt: null, trusted: false };
      }
      const entry = state.roots[key];
      if (!entry) {
        return { grantedAt: null, trusted: false };
      }
      return { grantedAt: entry.grantedAt, trusted: true };
    },

    async flush() {
      await store.flush();
      await grants.flush();
    },
  };

  activeFlush = () => service.flush();
  return service;
}
