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
  /** 数据源内稳定的调用或消息标识，仅用于跨存储去重，不参与费用聚合。 */
  eventId?: string;
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

export interface UsageModelBreakdown {
  estimatedCostMicrousd: number | null;
  modelId: string;
  totalTokens: number;
}

export interface UsageDataSnapshot {
  buckets: UsageDataDailyBucket[];
  coverage: UsageDataPublishInput["coverage"];
  observedAt: number;
  pluginId: string;
  scope: UsageDataScope;
  sourceId: string;
  summary: {
    /** 按模型分组的观测周期内总量。用于跨源聚合的 byModel 展示，
     *  未识别 modelId 归类到空串 `""`。 */
    byModel: UsageModelBreakdown[];
    estimatedCostMicrousd: number | null;
    latestDayTokens: number;
    periodTokens: number;
    todayEstimatedCostMicrousd: number | null;
  };
}

export interface MainPluginUsageSource {
  /** Plugin-scoped source id. Host prefixes it with `${pluginId}/` for uniqueness. */
  readonly id: string;
  /** Host calls this during `usageData.refreshAll()` fan-out. */
  rescan(): Promise<void>;
}

export interface MainPluginUsageData {
  publish(input: UsageDataPublishInput): Promise<UsageDataSnapshot>;
  read(
    sourceId: string,
    scope: UsageDataScope
  ): Promise<UsageDataSnapshot | null>;
  /**
   * Register the plugin as a refreshable usage source. Returns a dispose
   * callback the plugin should invoke on deactivation. The host prefixes the
   * plugin id in front of the caller-provided `source.id` before dispatching.
   */
  registerSource(source: MainPluginUsageSource): () => void;
}

export interface MainPluginModule {
  activate(context: MainPluginContext): (() => void) | Promise<() => void>;
  id: string;
}
