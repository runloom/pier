import { Avatar, AvatarFallback } from "@pier/ui/avatar.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader } from "@pier/ui/empty.tsx";
import { formatDurationShort, formatPercent } from "@pier/ui/format.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Progress } from "@pier/ui/progress.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { cn } from "@pier/ui/utils.ts";
import { RefreshCw, Trash2 } from "lucide-react";
import type { JSX } from "react";
import type {
  GrokAccountSummary,
  GrokUsageWindow,
} from "../shared/accounts.ts";
import { remainingPercent, usageRisk } from "../shared/usage.ts";
import type { Translate } from "./format-account-error.ts";
import { usageProgressVariant, usageWindowLabel } from "./usage-meter.tsx";

export function accountDisplayLabel(account: {
  email?: string | undefined;
  id: string;
  label?: string | undefined;
}): string {
  if (account.email && account.email.length > 0) return account.email;
  if (account.label && account.label.length > 0) return account.label;
  return account.id;
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

function Quota({
  compact = false,
  label,
  language,
  t,
  window,
}: {
  compact?: boolean;
  label: string;
  language: string;
  t: Translate;
  window: GrokUsageWindow;
}): JSX.Element {
  const remaining = remainingPercent(window.usedPercent);
  const reset =
    window.resetsAt && window.resetsAt > Date.now()
      ? formatDurationShort(window.resetsAt - Date.now(), language)
      : null;
  const risk = usageRisk(window.usedPercent);
  return (
    <div
      className="min-w-0"
      data-compact={compact || undefined}
      data-risk={risk}
      data-slot="grok-usage-progress"
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <span className="font-semibold text-xs">{label}</span>
        <strong className="font-semibold tabular-nums tracking-tight">
          {formatPercent(remaining / 100, language)}
        </strong>
      </div>
      <Progress
        aria-label={`${label} ${formatPercent(remaining / 100, language)}`}
        className={compact ? "h-1" : "h-1.5"}
        value={remaining}
        variant={usageProgressVariant(risk)}
      />
      <div className="mt-2 min-h-4 text-right text-muted-foreground text-xs tabular-nums">
        {reset
          ? `${t("pier.grok.widget.resetsIn", "Resets in")} ${reset}`
          : "—"}
      </div>
    </div>
  );
}

export function QuotaGroup({
  compact = false,
  error,
  language,
  loading = false,
  t,
  windows,
}: {
  compact?: boolean;
  error: string | undefined;
  language: string;
  loading?: boolean;
  t: Translate;
  windows: GrokUsageWindow[];
}): JSX.Element {
  if (loading) {
    return (
      <Skeleton
        className={cn("w-full", compact ? "h-16" : "h-19")}
        data-slot="grok-usage-loading"
      />
    );
  }

  const errorBanner =
    error !== undefined && error.length > 0 ? (
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

  if (windows.length === 0) {
    if (errorBanner) {
      return errorBanner;
    }
    return (
      <Empty className="min-h-19 gap-0 border-0 p-3">
        <EmptyHeader className="gap-0">
          <EmptyDescription>
            {t("pier.grok.accounts.settings.noUsage", "No usage data")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3",
        compact && "flex-1 max-[48rem]:col-span-full max-[48rem]:row-start-2"
      )}
      data-count={windows.length}
      data-slot="grok-quota-group"
    >
      {errorBanner}
      <div
        className={cn(
          "grid min-w-0 grid-cols-2 gap-4 data-[count=1]:grid-cols-1 max-[36rem]:grid-cols-1"
        )}
      >
        {windows.map((window) => (
          <Quota
            compact={compact}
            key={window.id}
            label={usageWindowLabel(window, language, t)}
            language={language}
            t={t}
            window={window}
          />
        ))}
      </div>
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
          <ItemDescription>
            {account.kind === "api_key" ? "API key" : "OIDC"}
          </ItemDescription>
        </ItemContent>
        <QuotaGroup
          compact
          error={account.usage?.error}
          language={language}
          loading={!account.usage}
          t={t}
          windows={account.usage?.windows ?? []}
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
