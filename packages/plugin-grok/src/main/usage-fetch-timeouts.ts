/**
 * Grok transport timeout policy. Primitives live in @pier/plugin-api/account-usage;
 * only hop budgets and error copy are plugin-specific.
 */
import {
  assertMultiHopBudget,
  createMultiHopBudgetPolicy,
  type MultiHopBudgetPolicy,
} from "@pier/plugin-api/account-usage";

export {
  createTimeoutSignal,
  isTimeoutOrAbortError,
  mergeAbortSignals,
} from "@pier/plugin-api/account-usage";

export const BILLING_TIMEOUT_ERROR = "Grok billing request timed out";

const GROK_USAGE_BUDGET: MultiHopBudgetPolicy = createMultiHopBudgetPolicy({
  hopTimeoutMs: {
    billing: 15_000,
    oidcRefresh: 12_000,
  },
  overallDeadlineMs: 45_000,
  retryOverallDeadlineMs: 20_000,
  worstPathHopIds: ["oidcRefresh", "billing", "billing"],
});

export const OIDC_REFRESH_TIMEOUT_MS =
  GROK_USAGE_BUDGET.hopTimeoutMs.oidcRefresh ?? 12_000;
export const BILLING_HOP_TIMEOUT_MS =
  GROK_USAGE_BUDGET.hopTimeoutMs.billing ?? 15_000;
export const USAGE_OVERALL_DEADLINE_MS = GROK_USAGE_BUDGET.overallDeadlineMs;
export const USAGE_RETRY_OVERALL_DEADLINE_MS =
  GROK_USAGE_BUDGET.retryOverallDeadlineMs;

export function assertUsageTimeoutBudget(): void {
  assertMultiHopBudget(GROK_USAGE_BUDGET);
}
