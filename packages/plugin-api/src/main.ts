/**
 * Public external main plugin API. External Codex plugin main import target.
 * DO NOT re-export host internal state — this file is the trust boundary
 * between host and external plugins (design §7.1).
 */

export interface MainPluginContext {
  events: {
    emit(event: string, payload: unknown): void;
  };
  lifecycle: {
    onBeforeQuit(callback: () => Promise<void> | void): void;
  };
  logger: {
    debug(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
  };
  paths: {
    dataDir: string;
    workDir: string;
  };
  plugin: {
    id: string;
    version: string;
  };
  processEnv: Readonly<Record<string, string | undefined>>;
  rpc: {
    handle(
      method: string,
      handler: (payload: unknown) => Promise<unknown>
    ): void;
  };
  secrets: {
    delete(key: string): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  usageData: MainPluginUsageData;
}

export type UsageDataScope =
  | { kind: "machine" }
  | { key: string; kind: "account" };

export interface UsageTokenObservation {
  cachedInputTokens: number;
  date: string;
  inputTokens: number;
  modelId: string | null;
  outputTokens: number;
  reasoningTokens?: number;
  serviceTier?: string;
  totalTokens?: number;
}

export interface UsageDataPublishInput {
  coverage: {
    complete: boolean;
    from: string;
    to: string;
  };
  observations: UsageTokenObservation[];
  observedAt: number;
  scope: UsageDataScope;
  sourceId: string;
}

export interface UsageTokenTotals {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface UsageDataDailyBucket {
  date: string;
  estimatedCostMicrousd: number | null;
  pricingStatus: "complete" | "partial" | "unpriced";
  tokens: UsageTokenTotals;
}

export interface UsageDataSnapshot {
  buckets: UsageDataDailyBucket[];
  coverage: UsageDataPublishInput["coverage"];
  observedAt: number;
  pluginId: string;
  scope: UsageDataScope;
  sourceId: string;
  summary: {
    estimatedCostMicrousd: number | null;
    latestDayTokens: number;
    periodTokens: number;
    todayEstimatedCostMicrousd: number | null;
  };
}

export interface MainPluginUsageData {
  publish(input: UsageDataPublishInput): Promise<UsageDataSnapshot>;
  read(
    sourceId: string,
    scope: UsageDataScope
  ): Promise<UsageDataSnapshot | null>;
}

export interface MainPluginModule {
  activate(context: MainPluginContext): (() => void) | Promise<() => void>;
  id: string;
}
