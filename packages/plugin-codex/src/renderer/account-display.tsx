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
import { formatRelativeTime } from "@pier/ui/format.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { RefreshCw, Trash2 } from "lucide-react";
import type { JSX } from "react";
import type { CodexAccountSummary } from "../shared/accounts.ts";
import {
  type Translate,
  UsageMeter,
  usageMetricLabel,
} from "./usage-meter.tsx";

export function AccountAvatar({
  label,
  size = "default",
}: {
  label: string;
  size?: "default" | "lg" | "sm";
}): JSX.Element {
  return (
    <Avatar size={size}>
      <AvatarFallback>
        {label.trim().charAt(0).toUpperCase() || "C"}
      </AvatarFallback>
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
        data-slot="codex-usage-loading"
      />
    );
  }

  const errorBanner =
    error !== undefined && error.length > 0 ? (
      <div
        className="flex w-full flex-col gap-1 text-sm"
        data-slot="codex-usage-error"
        role="alert"
      >
        <p className="text-destructive">
          {t("pier.codex.accounts.settings.usageFailed", "Usage update failed")}
        </p>
        <p className="break-all text-muted-foreground text-xs">{error}</p>
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
      data-slot="codex-quota-group"
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

export function codexAccountMembership(
  account: Pick<CodexAccountSummary, "planType" | "subscriptionExpiresAt">,
  updatedAt: number,
  now = Date.now()
): AccountMembershipSnapshot | undefined {
  if (!account.planType) return;
  const tier = account.planType.toLowerCase();
  const free = tier === "free" || tier === "none";
  let status: AccountMembershipSnapshot["status"] = "active";
  if (free) {
    status = "free";
  } else if (
    account.subscriptionExpiresAt !== undefined &&
    account.subscriptionExpiresAt <= now
  ) {
    status = "expired";
  }
  return {
    ...(account.subscriptionExpiresAt === undefined
      ? {}
      : { expiresAt: account.subscriptionExpiresAt }),
    status,
    tier,
    updatedAt,
  };
}

/** Text fallback for compact menu rows that cannot host metadata badges. */
export function accountPlanSummary(
  account: Pick<CodexAccountSummary, "planType" | "subscriptionExpiresAt">,
  language: string,
  t: Translate,
  now = Date.now()
): string | null {
  if (!account.planType) return null;
  const tier = account.planType.toUpperCase();
  if (
    account.subscriptionExpiresAt === undefined ||
    tier === "FREE" ||
    tier === "NONE"
  ) {
    return tier;
  }
  return `${tier} · ${t("pier.codex.accounts.settings.expires", "Expires")} ${formatRelativeTime(account.subscriptionExpiresAt, now, language)}`;
}

export function AccountBadges({
  account,
  language,
  mode = "all",
  t,
}: {
  account: Pick<
    CodexAccountSummary,
    "planType" | "subscriptionExpiresAt" | "usage"
  >;
  language: string;
  mode?: AccountMetadataBadgeMode;
  t: Translate;
}): JSX.Element | null {
  const updatedAt = account.usage?.updatedAt;
  const membership = codexAccountMembership(account, updatedAt ?? 0);
  return (
    <AccountMetadataBadges
      copy={{
        cancelAtPeriodEnd: t(
          "pier.codex.accounts.settings.cancelAtPeriodEnd",
          "Cancels at period end"
        ),
        cancelsOn: (relative) =>
          t(
            "pier.codex.accounts.settings.cancelsOn",
            "Cancels {relative}"
          ).replace("{relative}", relative),
        expired: t("pier.codex.accounts.settings.expired", "Expired"),
        expires: (relative) =>
          `${t("pier.codex.accounts.settings.expires", "Expires")} ${relative}`,
        trialEnds: (relative) =>
          `${t("pier.codex.accounts.settings.trialEnds", "Trial ends")} ${relative}`,
      }}
      language={language}
      {...(membership ? { membership } : {})}
      membershipLabel={(membership) => membership.tier.toUpperCase()}
      metricLabel={(metric) => usageMetricLabel(metric, language, t)}
      metrics={account.usage?.metrics ?? []}
      mode={mode}
    />
  );
}

function IconAction({
  disabled = false,
  icon: Icon,
  label,
  onClick,
  spinning = false,
}: {
  disabled?: boolean;
  icon: typeof RefreshCw;
  label: string;
  onClick: () => void;
  spinning?: boolean;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-busy={spinning || undefined}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Icon
            className={cn(
              spinning && "animate-spin motion-reduce:animate-none"
            )}
            data-icon="inline-start"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent data-pier-codex-scope="">{label}</TooltipContent>
    </Tooltip>
  );
}

export function OtherAccount({
  account,
  language,
  onRefresh,
  onRemove,
  onSelect,
  refreshing,
  t,
}: {
  account: CodexAccountSummary;
  language: string;
  onRefresh: () => void;
  onRemove: () => void;
  onSelect: () => void;
  refreshing: boolean;
  t: Translate;
}): JSX.Element {
  return (
    <Item
      asChild
      className="!grid grid-cols-[auto_15rem_minmax(17rem,1fr)_auto] items-center gap-3 max-[48rem]:grid-cols-[auto_minmax(0,1fr)_auto]"
      size="sm"
    >
      <li data-testid="codex-account-usage-row">
        <ItemMedia align="center">
          <AccountAvatar label={account.label} />
        </ItemMedia>
        <ItemContent className="w-60 min-w-0 flex-none max-[48rem]:w-auto max-[48rem]:flex-1">
          <ItemTitle title={account.label}>{account.label}</ItemTitle>
          <AccountBadges account={account} language={language} t={t} />
        </ItemContent>
        <QuotaGroup
          compact
          error={account.usage?.error}
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
        <TooltipProvider delayDuration={200}>
          <ItemActions>
            <Button
              aria-label={`${t("pier.codex.accounts.settings.switch", "Switch")}: ${account.label}`}
              onClick={onSelect}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("pier.codex.accounts.settings.switch", "Switch")}
            </Button>
            <IconAction
              disabled={refreshing}
              icon={RefreshCw}
              label={`${t("pier.codex.accounts.settings.refreshUsage", "Refresh usage")}: ${account.label}`}
              onClick={onRefresh}
              spinning={refreshing}
            />
            <IconAction
              icon={Trash2}
              label={`${t("pier.codex.accounts.settings.remove", "Remove")}: ${account.label}`}
              onClick={onRemove}
            />
          </ItemActions>
        </TooltipProvider>
      </li>
    </Item>
  );
}
