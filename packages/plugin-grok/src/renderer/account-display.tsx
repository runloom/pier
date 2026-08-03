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
import { Spinner } from "@pier/ui/spinner.tsx";
import { cn } from "@pier/ui/utils.ts";
import { RefreshCw, Trash2 } from "lucide-react";
import type { JSX } from "react";
import type {
  GrokAccountSummary,
  GrokSubscriptionSummary,
} from "../shared/accounts.ts";
import {
  isTransientUsageError,
  type Translate,
} from "./format-account-error.ts";
import { UsageMeter, usageMetricLabel } from "./usage-meter.tsx";

export function accountDisplayLabel(account: {
  email?: string | undefined;
  id: string;
  label?: string | undefined;
}): string {
  if (account.email && account.email.length > 0) return account.email;
  if (account.label && account.label.length > 0) return account.label;
  return account.id;
}

/** Compact membership + auth-kind line for settings/widget/picker. */
export function accountMembershipSummary(
  account: {
    kind: GrokAccountSummary["kind"];
    subscription?: GrokSubscriptionSummary | undefined;
  },
  language: string,
  t: Translate,
  now = Date.now()
): string {
  const kindLabel =
    account.kind === "api_key"
      ? t("pier.grok.accounts.settings.authKindApiKey", "API key")
      : t("pier.grok.accounts.settings.authKindOidc", "OIDC");
  const subscription = account.subscription;
  if (!subscription) return kindLabel;

  const plan = subscription.planType.toUpperCase();
  const parts: string[] = [plan];
  const periodEndAt = subscription.trialEndsAt ?? subscription.expiresAt;
  if (subscription.cancelAtPeriodEnd && periodEndAt !== undefined) {
    const relative = formatRelativeTime(periodEndAt, now, language);
    parts.push(
      t("pier.grok.accounts.settings.cancelsOn", "Cancels {relative}").replace(
        "{relative}",
        relative
      )
    );
  } else if (subscription.trialEndsAt !== undefined) {
    parts.push(
      t("pier.grok.accounts.settings.trialEnds", "Trial ends").concat(
        " ",
        formatRelativeTime(subscription.trialEndsAt, now, language)
      )
    );
  } else if (subscription.expiresAt !== undefined) {
    parts.push(
      t("pier.grok.accounts.settings.expires", "Expires").concat(
        " ",
        formatRelativeTime(subscription.expiresAt, now, language)
      )
    );
  } else if (subscription.cancelAtPeriodEnd) {
    parts.push(
      t(
        "pier.grok.accounts.settings.cancelAtPeriodEnd",
        "Cancels at period end"
      )
    );
  }
  parts.push(kindLabel);
  return parts.join(" · ");
}

export function AccountBadges({
  account,
  includeScalars = false,
  language,
  mode = "all",
  t,
}: {
  account: Pick<GrokAccountSummary, "kind" | "subscription" | "usage">;
  includeScalars?: boolean;
  language: string;
  mode?: AccountMetadataBadgeMode;
  t: Translate;
}): JSX.Element | null {
  const updatedAt = account.usage?.updatedAt;
  const membership = grokAccountMembership(account, updatedAt ?? 0);
  return (
    <AccountMetadataBadges
      copy={{
        cancelAtPeriodEnd: t(
          "pier.grok.accounts.settings.cancelAtPeriodEnd",
          "Cancels at period end"
        ),
        cancelsOn: (relative) =>
          t(
            "pier.grok.accounts.settings.cancelsOn",
            "Cancels {relative}"
          ).replace("{relative}", relative),
        expired: t("pier.grok.accounts.settings.expired", "Expired"),
        expires: (relative) =>
          `${t("pier.grok.accounts.settings.expires", "Expires")} ${relative}`,
        trialEnds: (relative) =>
          `${t("pier.grok.accounts.settings.trialEnds", "Trial ends")} ${relative}`,
      }}
      identityLabel={
        account.kind === "api_key"
          ? t("pier.grok.accounts.settings.authKindApiKey", "API key")
          : t("pier.grok.accounts.settings.authKindOidc", "OIDC")
      }
      language={language}
      {...(membership ? { membership } : {})}
      membershipLabel={(value) => value.tier.toUpperCase().replaceAll("_", " ")}
      metricLabel={(metric) => usageMetricLabel(metric, language, t)}
      metrics={includeScalars ? (account.usage?.metrics ?? []) : []}
      mode={mode}
    />
  );
}

export function grokAccountMembership(
  account: Pick<GrokAccountSummary, "subscription">,
  updatedAt: number
): AccountMembershipSnapshot | undefined {
  const subscription = account.subscription;
  let membershipStatus: AccountMembershipSnapshot["status"] | undefined;
  if (subscription?.status === "none") {
    membershipStatus = "free";
  } else if (subscription) {
    membershipStatus = subscription.status;
  }
  return subscription
    ? {
        ...(subscription.cancelAtPeriodEnd === undefined
          ? {}
          : { cancelAtPeriodEnd: subscription.cancelAtPeriodEnd }),
        ...(subscription.expiresAt === undefined
          ? {}
          : { expiresAt: subscription.expiresAt }),
        status: membershipStatus ?? "unknown",
        tier: subscription.planType,
        ...(subscription.trialEndsAt === undefined
          ? {}
          : { trialEndsAt: subscription.trialEndsAt }),
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
  errorTransient = false,
  language,
  loading = false,
  metrics,
  status,
  t,
  updatedAt,
}: {
  compact?: boolean;
  error: string | undefined;
  errorTransient?: boolean;
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
        data-slot="grok-usage-loading"
      />
    );
  }

  const hasError = error !== undefined && error.length > 0;
  const errorBanner =
    hasError && !errorTransient ? (
      <div
        className="flex w-full flex-col gap-1 text-sm"
        data-slot="grok-usage-error"
        role="alert"
      >
        <p className="text-destructive">
          {t("pier.grok.accounts.settings.usageFailed", "Usage update failed")}
        </p>
        <p className="break-all text-muted-foreground text-xs">{error}</p>
      </div>
    ) : null;
  // Transient failure: last-good data stays on screen without alarm. Only
  // when there is nothing to show do we surface a muted note, not a red
  // banner — the next poll retries automatically.
  const transientNote =
    hasError && errorTransient && metrics.length === 0 ? (
      <p
        className="w-full text-muted-foreground text-sm"
        data-slot="grok-usage-error"
      >
        {t(
          "pier.grok.errors.usageTemporarilyUnavailable",
          "Could not update Grok usage right now — will retry automatically"
        )}
      </p>
    ) : null;

  if (metrics.length === 0) {
    if (errorBanner) {
      return errorBanner;
    }
    if (transientNote) {
      return transientNote;
    }
  }

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-3",
        compact && "flex-1 max-[48rem]:col-span-full max-[48rem]:row-start-2"
      )}
      data-count={metrics.length}
      data-slot="grok-quota-group"
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
  onRefresh,
  onRemove,
  onSelect,
  refreshing = false,
  t,
}: {
  account: GrokAccountSummary;
  busy?: boolean;
  language: string;
  onRefresh: (accountId: string) => void;
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
      <li data-testid="grok-account-usage-row">
        <ItemMedia align="center">
          <AccountAvatar label={label} size="sm" />
        </ItemMedia>
        <ItemContent className="w-60 min-w-0 flex-none max-[48rem]:w-auto max-[48rem]:flex-1">
          <ItemTitle title={label}>{label}</ItemTitle>
          <AccountBadges account={account} language={language} t={t} />
        </ItemContent>
        <QuotaGroup
          compact
          error={account.usage?.error}
          errorTransient={isTransientUsageError(account.usage?.error)}
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
            aria-label={`${t("pier.grok.accounts.settings.switch", "Switch")}: ${label}`}
            disabled={actionsDisabled}
            onClick={() => onSelect(account.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {t("pier.grok.accounts.settings.switch", "Switch")}
          </Button>
          <Button
            aria-busy={refreshing || undefined}
            aria-label={`${t("pier.grok.accounts.settings.refreshUsage", "Refresh usage")}: ${label}`}
            disabled={actionsDisabled}
            onClick={() => onRefresh(account.id)}
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
            aria-label={`${t("pier.grok.accounts.settings.remove", "Remove")}: ${label}`}
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
