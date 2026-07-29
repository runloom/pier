import type {
  AccountMembershipSnapshot,
  AccountUsageMetric,
} from "@pier/plugin-api/account-usage";
import {
  type AccountMetadataBadgeMode,
  AccountMetadataBadges,
} from "@pier/plugin-api/account-usage/renderer";
import { Avatar, AvatarFallback } from "@pier/ui/avatar.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { cn } from "@pier/ui/utils";
import { RefreshCw, Trash2 } from "lucide-react";
import type { JSX } from "react";
import type {
  ClaudeAccountSummary,
  ClaudeSubscriptionSummary,
} from "../shared/accounts.ts";
import { formatAccountError, type Translate } from "./format-account-error.ts";
import { UsageMeter, usageMetricLabel } from "./usage-meter.tsx";

export function accountDisplayLabel(account: {
  email?: string | undefined;
  id: string;
  label?: string | undefined;
}): string {
  if (account.email && account.email.length > 0) {
    return account.email;
  }
  if (account.label && account.label.length > 0) {
    return account.label;
  }
  return account.id;
}

/** Compact subscription/membership line for settings/widget/picker. */
export function accountMembershipSummary(
  account: {
    subscription?: ClaudeSubscriptionSummary | undefined;
  },
  _language: string,
  t: Translate
): string {
  const subscription = account.subscription;
  if (!subscription) {
    return t("pier.claude.accounts.settings.subscriptionUnknown", "Claude");
  }
  const parts: string[] = [subscription.planType.toUpperCase()];
  if (subscription.organizationName) {
    parts.push(subscription.organizationName);
  }
  return parts.join(" · ");
}

export function AccountBadges({
  account,
  includeScalars = false,
  language,
  mode = "all",
  t,
}: {
  account: Pick<ClaudeAccountSummary, "subscription" | "usage">;
  includeScalars?: boolean;
  language: string;
  mode?: AccountMetadataBadgeMode;
  t: Translate;
}): JSX.Element | null {
  const updatedAt = account.usage?.updatedAt;
  const membership = claudeAccountMembership(account, updatedAt ?? 0);
  return (
    <AccountMetadataBadges
      copy={{
        cancelAtPeriodEnd: t(
          "pier.claude.accounts.settings.cancelAtPeriodEnd",
          "Cancels at period end"
        ),
        expired: t("pier.claude.accounts.settings.expired", "Expired"),
        expires: (relative) =>
          `${t("pier.claude.accounts.settings.expires", "Expires")} ${relative}`,
        trialEnds: (relative) =>
          `${t("pier.claude.accounts.settings.trialEnds", "Trial ends")} ${relative}`,
      }}
      language={language}
      {...(membership ? { membership } : {})}
      membershipLabel={(value) => value.tier.toUpperCase().replaceAll("-", " ")}
      metricLabel={(metric) => usageMetricLabel(metric, t)}
      metrics={includeScalars ? (account.usage?.metrics ?? []) : []}
      mode={mode}
    />
  );
}

export function claudeAccountMembership(
  account: Pick<ClaudeAccountSummary, "subscription">,
  updatedAt: number
): AccountMembershipSnapshot | undefined {
  const tier = account.subscription?.planType;
  return tier
    ? {
        status:
          tier.toLowerCase() === "free" || tier.toLowerCase() === "none"
            ? "free"
            : "active",
        tier,
        updatedAt: updatedAt ?? 0,
      }
    : undefined;
}

export function AccountAvatar({
  label,
  size = "default",
}: {
  label: string;
  size?: "default" | "sm";
}): JSX.Element {
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <Avatar size={size === "sm" ? "sm" : "default"}>
      <AvatarFallback>{initial}</AvatarFallback>
    </Avatar>
  );
}

export function QuotaGroup({
  compact = false,
  error,
  language,
  loading = false,
  metrics,
  status,
  t,
  updatedAt,
}: {
  compact?: boolean;
  error: string | undefined;
  language: string;
  loading?: boolean;
  metrics: readonly AccountUsageMetric[];
  status: "error" | "ok";
  t: Translate;
  updatedAt?: number;
}): JSX.Element {
  if (loading) {
    return (
      <Skeleton
        className={cn("w-full", compact ? "h-16" : "h-19")}
        data-slot="claude-usage-loading"
      />
    );
  }

  const errorBanner =
    error !== undefined && error.length > 0 ? (
      <div
        className="flex w-full flex-col gap-1 text-sm"
        data-slot="claude-usage-error"
        role="alert"
      >
        <p className="text-destructive">
          {t(
            "pier.claude.accounts.settings.usageFailed",
            "Usage update failed"
          )}
        </p>
        <p className="break-all text-muted-foreground text-xs">
          {formatAccountError(error, t)}
        </p>
      </div>
    ) : null;

  if (metrics.length === 0 && errorBanner) {
    return errorBanner;
  }

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-3",
        compact && "flex-1 max-[48rem]:col-span-full max-[48rem]:row-start-2"
      )}
      data-count={metrics.length}
      data-slot="claude-quota-group"
    >
      {errorBanner}
      <UsageMeter
        language={language}
        metrics={metrics}
        status={status}
        t={t}
        {...(updatedAt === undefined ? {} : { updatedAt })}
      />
    </div>
  );
}

export function OtherAccount({
  account,
  busy = false,
  language,
  onRefreshUsage,
  onRemove,
  onSelect,
  refreshing = false,
  t,
}: {
  account: ClaudeAccountSummary;
  busy?: boolean;
  language: string;
  onRefreshUsage: (accountId: string) => void;
  onRemove: (accountId: string) => void;
  onSelect: (accountId: string) => void;
  refreshing?: boolean;
  t: Translate;
}): JSX.Element {
  const label = accountDisplayLabel(account);
  const actionsDisabled = busy || refreshing;
  return (
    <Item
      asChild
      className="!grid grid-cols-[auto_15rem_minmax(17rem,1fr)_auto] items-center gap-3 max-[48rem]:grid-cols-[auto_minmax(0,1fr)_auto]"
      size="sm"
    >
      <li data-testid="claude-account-row">
        <ItemMedia align="center">
          <AccountAvatar label={label} size="sm" />
        </ItemMedia>
        <ItemContent className="w-60 min-w-0 flex-none max-[48rem]:w-auto max-[48rem]:flex-1">
          <ItemTitle title={label}>{label}</ItemTitle>
          {account.error ? (
            <ItemDescription>
              {formatAccountError(account.error, t)}
            </ItemDescription>
          ) : (
            <AccountBadges account={account} language={language} t={t} />
          )}
        </ItemContent>
        <QuotaGroup
          compact
          error={
            account.usage?.status === "error"
              ? (account.usage.error ??
                t(
                  "pier.claude.accounts.settings.usageFailed",
                  "Usage update failed"
                ))
              : undefined
          }
          language={language}
          loading={!account.usage}
          metrics={
            account.usage?.metrics.filter(
              (metric) => metric.kind === "quota"
            ) ?? []
          }
          status={account.usage?.status ?? "ok"}
          t={t}
          {...(account.usage?.updatedAt === undefined
            ? {}
            : { updatedAt: account.usage.updatedAt })}
        />
        <ItemActions className="gap-1">
          <Button
            aria-label={`${t("pier.claude.accounts.settings.switch", "Switch")}: ${label}`}
            disabled={actionsDisabled}
            onClick={() => onSelect(account.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {t("pier.claude.accounts.settings.switch", "Switch")}
          </Button>
          <Button
            aria-busy={refreshing || undefined}
            aria-label={`${t("pier.claude.accounts.settings.refreshUsage", "Refresh usage")}: ${label}`}
            disabled={actionsDisabled}
            onClick={() => onRefreshUsage(account.id)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw
              className={cn(
                refreshing && "animate-spin motion-reduce:animate-none"
              )}
              data-icon="inline-start"
            />
          </Button>
          <Button
            aria-label={`${t("pier.claude.accounts.settings.remove", "Remove")}: ${label}`}
            disabled={actionsDisabled}
            onClick={() => onRemove(account.id)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 data-icon="inline-start" />
          </Button>
        </ItemActions>
      </li>
    </Item>
  );
}
