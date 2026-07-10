import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentUsageState,
  agentUsageStateSchema,
  EMPTY_AGENT_USAGE_STATE,
} from "@shared/contracts/agent-usage.ts";
import { debouncedJsonStore } from "../../state/debounced-store.ts";

export interface AgentUsageService {
  flush(): Promise<void>;
  read(): Promise<AgentUsageState>;
  recordSuccessfulLaunch(agentId: AgentKind): Promise<AgentUsageState>;
}

export interface CreateAgentUsageServiceOptions {
  now?: () => number;
  userDataDir: string;
}

export function recordAgentUse(
  state: AgentUsageState,
  agentId: AgentKind,
  now: number
): AgentUsageState {
  const existing = state.entries.find((entry) => entry.agentId === agentId);
  return {
    entries: [
      {
        agentId,
        lastUsedAt: now,
        useCount: (existing?.useCount ?? 0) + 1,
      },
      ...state.entries.filter((entry) => entry.agentId !== agentId),
    ],
    version: 1,
  };
}

export function createAgentUsageService({
  now = Date.now,
  userDataDir,
}: CreateAgentUsageServiceOptions): AgentUsageService {
  const store = debouncedJsonStore<AgentUsageState>({
    debounceMs: 500,
    defaults: EMPTY_AGENT_USAGE_STATE,
    filePath: join(userDataDir, "agent-usage.json"),
  });
  let initialized = false;
  let initializePromise: Promise<void> | null = null;

  async function ensureInitialized(): Promise<void> {
    if (initialized) {
      return;
    }
    if (!initializePromise) {
      initializePromise = store
        .init()
        .then(async (raw) => {
          if (!agentUsageStateSchema.safeParse(raw).success) {
            await store.clear();
            await store.init();
          }
          initialized = true;
        })
        .finally(() => {
          initializePromise = null;
        });
    }
    await initializePromise;
  }

  return {
    async flush() {
      await ensureInitialized();
      await store.flush();
    },
    async read() {
      await ensureInitialized();
      return store.get();
    },
    async recordSuccessfulLaunch(agentId) {
      await ensureInitialized();
      return store.mutate((state) => recordAgentUse(state, agentId, now()));
    },
  };
}
