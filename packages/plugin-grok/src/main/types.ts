import type { GrokSubscriptionInfo } from "./subscription-parse.ts";

export interface AccountUsageResult {
  error?: string;
  status: "error" | "ok";
  /** Soft-attached membership; omit when unavailable. */
  subscription?: GrokSubscriptionInfo;
  windows: Array<{
    id: string;
    limitId: string;
    limitName?: string;
    resetsAt?: number;
    usedPercent: number;
    windowMinutes?: number;
  }>;
}
