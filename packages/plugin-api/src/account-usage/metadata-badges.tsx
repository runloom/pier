import { Badge } from "@pier/ui/badge.tsx";
import {
  formatCount,
  formatCurrency,
  formatRelativeTime,
} from "@pier/ui/format.tsx";
import type { JSX } from "react";
import {
  type AccountMetadataBadgeMode,
  membershipNeedsAttention,
  membershipPeriodNeedsAttention,
} from "./membership-attention.ts";
import type { AccountMembershipSnapshot } from "./membership-cache.ts";
import type {
  AccountUsageMetric,
  AccountUsageScalarMetric,
} from "./usage-cache.ts";

export interface AccountMetadataBadgesCopy {
  /** Fallback when cancel-at-period-end has no usable end date. */
  cancelAtPeriodEnd: string;
  /**
   * Combined chip when cancel-at-period-end and a known end date.
   * `relative` is already localized (e.g. "in 31 days" / "47天后").
   */
  cancelsOn: (relative: string) => string;
  expired: string;
  expires: (relative: string) => string;
  trialEnds: (relative: string) => string;
}

export interface AccountMetadataBadgesProps {
  copy: AccountMetadataBadgesCopy;
  identityLabel?: string;
  language: string;
  membership?: AccountMembershipSnapshot;
  membershipLabel: (membership: AccountMembershipSnapshot) => string;
  metricLabel: (metric: AccountUsageMetric) => string;
  metrics: readonly AccountUsageMetric[];
  mode?: AccountMetadataBadgeMode;
  now?: number;
}

function formatScalar(
  metric: AccountUsageScalarMetric,
  language: string
): string {
  if (metric.format === "currency") {
    return formatCurrency(metric.value, language, metric.currency ?? "USD");
  }
  if (metric.format === "count") {
    return formatCount(metric.value, language);
  }
  return new Intl.NumberFormat(language).format(metric.value);
}

function membershipVariant(
  membership: AccountMembershipSnapshot
): "danger" | "info" | "neutral" | "warning" {
  if (membership.status === "expired") return "danger";
  if (membership.status === "canceled") return "warning";
  if (membership.status === "free" || membership.status === "unknown") {
    return "neutral";
  }
  return "info";
}

function periodEndTimestamp(
  membership: AccountMembershipSnapshot
): number | undefined {
  return membership.trialEndsAt ?? membership.expiresAt;
}

export function AccountMetadataBadges({
  copy,
  identityLabel,
  language,
  membership,
  membershipLabel,
  metricLabel,
  metrics,
  mode = "all",
  now = Date.now(),
}: AccountMetadataBadgesProps): JSX.Element | null {
  if (mode === "hidden") return null;
  const membershipVisible =
    mode === "all" ||
    mode === "tier" ||
    (mode === "attention" && membershipNeedsAttention(membership, now));
  const identityVisible =
    identityLabel !== undefined && (mode === "all" || mode === "tier");
  const scalars = metrics.filter(
    (metric): metric is AccountUsageScalarMetric => metric.kind === "scalar"
  );
  const visibleScalars = mode === "all" ? scalars : [];
  if (!(identityVisible || membershipVisible || visibleScalars.length > 0)) {
    return null;
  }

  // cancelAtPeriodEnd + known end date → one chip (time + no renew).
  // Color follows the same proximity window as plain expiry: far-away is
  // neutral, within attention / expired / canceled is warning. Avoids
  // stacking "Expires in 47 days" next to "Cancels at period end".
  let periodBadge: JSX.Element | null = null;
  let cancelBadge: JSX.Element | null = null;
  if (mode !== "tier" && membership) {
    const periodEndAt = periodEndTimestamp(membership);
    const cancelAtEnd = membership.cancelAtPeriodEnd === true;
    const isExpired = membership.status === "expired";

    if (cancelAtEnd && periodEndAt !== undefined && !isExpired) {
      const cancelVariant = membershipPeriodNeedsAttention(membership, now)
        ? "warning"
        : "neutral";
      cancelBadge = (
        <Badge size="xs" variant={cancelVariant}>
          {copy.cancelsOn(formatRelativeTime(periodEndAt, now, language))}
        </Badge>
      );
    } else {
      if (membership.trialEndsAt !== undefined) {
        periodBadge = (
          <Badge size="xs" variant="warning">
            {copy.trialEnds(
              formatRelativeTime(membership.trialEndsAt, now, language)
            )}
          </Badge>
        );
      } else if (membership.expiresAt !== undefined) {
        // Period color: proximity / expired / canceled only.
        let variant: "danger" | "neutral" | "warning" = "neutral";
        if (isExpired) {
          variant = "danger";
        } else if (membershipPeriodNeedsAttention(membership, now)) {
          variant = "warning";
        }
        periodBadge = (
          <Badge size="xs" variant={variant}>
            {isExpired
              ? copy.expired
              : copy.expires(
                  formatRelativeTime(membership.expiresAt, now, language)
                )}
          </Badge>
        );
      }
      if (cancelAtEnd) {
        // No usable end date — keep warning so cancel without a date still
        // surfaces as an attention signal.
        cancelBadge = (
          <Badge size="xs" variant="warning">
            {copy.cancelAtPeriodEnd}
          </Badge>
        );
      }
    }
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5"
      data-slot="account-metadata-badges"
    >
      {membershipVisible && membership ? (
        <Badge size="xs" variant={membershipVariant(membership)}>
          {membershipLabel(membership)}
        </Badge>
      ) : null}
      {identityVisible ? (
        <Badge size="xs" variant="neutral">
          {identityLabel}
        </Badge>
      ) : null}
      {periodBadge}
      {cancelBadge}
      {visibleScalars.map((metric) => (
        <Badge key={metric.id} size="xs" variant="neutral">
          {metricLabel(metric)} {formatScalar(metric, language)}
        </Badge>
      ))}
    </div>
  );
}
