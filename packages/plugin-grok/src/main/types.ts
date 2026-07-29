import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";
import type { GrokSubscriptionInfo } from "./subscription-parse.ts";

export interface AccountUsageResult {
  error?: string;
  metrics: AccountUsageMetric[];
  status: "error" | "ok";
  /** Soft-attached membership; omit when unavailable. */
  subscription?: GrokSubscriptionInfo;
  /** True only when a membership endpoint returned an authoritative result. */
  subscriptionResolved?: boolean;
}
