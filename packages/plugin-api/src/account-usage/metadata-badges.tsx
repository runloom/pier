import { Badge } from "@pier/ui/badge.tsx";
import {
  formatCount,
  formatCurrency,
  formatRelativeTime,
} from "@pier/ui/format.tsx";
import type { JSX } from "react";
import type { AccountMembershipSnapshot } from "./membership-cache.ts";
import type {
  AccountUsageMetric,
  AccountUsageScalarMetric,
} from "./usage-cache.ts";
import {
  type AccountMetadataBadgeMode,
  membershipNeedsAttention,
  membershipPeriodNeedsAttention,
} from "./widget-presentation.ts";

export interface AccountMetadataBadgesCopy {
  cancelAtPeriodEnd: string;
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
  let periodBadge: JSX.Element | null = null;
  if (mode !== "tier" && membership?.trialEndsAt !== undefined) {
    periodBadge = (
      <Badge size="xs" variant="warning">
        {copy.trialEnds(
          formatRelativeTime(membership.trialEndsAt, now, language)
        )}
      </Badge>
    );
  } else if (mode !== "tier" && membership?.expiresAt !== undefined) {
    // Period color only reflects proximity / expired / canceled — not
    // cancelAtPeriodEnd (that is a separate warning badge below).
    let variant: "danger" | "neutral" | "warning" = "neutral";
    if (membership.status === "expired") {
      variant = "danger";
    } else if (membershipPeriodNeedsAttention(membership, now)) {
      variant = "warning";
    }
    periodBadge = (
      <Badge size="xs" variant={variant}>
        {membership.status === "expired"
          ? copy.expired
          : copy.expires(
              formatRelativeTime(membership.expiresAt, now, language)
            )}
      </Badge>
    );
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
      {mode !== "tier" && membership?.cancelAtPeriodEnd ? (
        <Badge size="xs" variant="warning">
          {copy.cancelAtPeriodEnd}
        </Badge>
      ) : null}
      {visibleScalars.map((metric) => (
        <Badge key={metric.id} size="xs" variant="neutral">
          {metricLabel(metric)} {formatScalar(metric, language)}
        </Badge>
      ))}
    </div>
  );
}
