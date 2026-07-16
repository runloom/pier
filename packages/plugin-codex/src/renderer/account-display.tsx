import { Avatar, AvatarFallback } from "@pier/ui/avatar.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader } from "@pier/ui/empty.tsx";
import {
  formatCount,
  formatDurationShort,
  formatPercent,
} from "@pier/ui/format.tsx";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { RefreshCw, Trash2 } from "lucide-react";
import type { JSX } from "react";
import type {
  CodexAccountSummary,
  CodexUsageWindow,
} from "../shared/accounts.ts";
import { remainingPercent, usageRisk } from "../shared/usage.ts";
import {
  type Translate,
  usageProgressVariant,
  usageWindowLabel,
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
  window: CodexUsageWindow;
}): JSX.Element {
  const remaining = remainingPercent(window.usedPercent);
  const reset =
    window.resetsAt && window.resetsAt > Date.now()
      ? formatDurationShort(window.resetsAt - Date.now(), language)
      : null;
  const risk = usageRisk(window.usedPercent);
  return (
    <div
      className="w-full min-w-0"
      data-compact={compact || undefined}
      data-risk={risk}
      data-slot="codex-usage-progress"
    >
      <div className="mb-2.5 flex w-full items-baseline justify-between gap-4">
        <span className="min-w-0 truncate font-semibold text-xs">{label}</span>
        <strong className="shrink-0 font-semibold tabular-nums tracking-tight">
          {formatPercent(remaining / 100, language)}
        </strong>
      </div>
      <Progress
        aria-label={`${label} ${formatPercent(remaining / 100, language)}`}
        className={cn("w-full", compact ? "h-1" : "h-1.5")}
        value={remaining}
        variant={usageProgressVariant(risk)}
      />
      <div className="mt-2 min-h-4 w-full text-right text-muted-foreground text-xs tabular-nums">
        {reset
          ? `${t("pier.codex.widget.resetsIn", "Resets in")} ${reset}`
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
  windows: CodexUsageWindow[];
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

  if (windows.length === 0) {
    if (errorBanner) {
      return errorBanner;
    }
    return (
      <Empty className="min-h-19 gap-0 border-0 p-3">
        <EmptyHeader className="gap-0">
          <EmptyDescription>
            {t("pier.codex.accounts.settings.noUsage", "No usage data")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const single = windows.length === 1;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-3",
        compact && "flex-1 max-[48rem]:col-span-full max-[48rem]:row-start-2"
      )}
      data-count={windows.length}
      data-slot="codex-quota-group"
    >
      {errorBanner}
      {/*
        Single window: block + w-full only — never auto-fit grid.
        auto-fit with one item can still size the track to content on a wide
        settings card, leaving the meter on a half-row.
      */}
      <div
        className={cn(
          "w-full min-w-0",
          single
            ? "block"
            : "grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))] max-[36rem]:grid-cols-1"
        )}
        data-layout={single ? "single" : "auto-fit"}
        data-slot="codex-quota-grid"
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

export function resetCredits(
  account: CodexAccountSummary,
  language: string,
  t: Translate
): string | null {
  const value = account.usage?.resetCreditsAvailable;
  if (value === undefined || value <= 0) return null;
  return t(
    "pier.codex.accounts.settings.resetCredits",
    "{count} quota resets available"
  ).replace("{count}", formatCount(value, language));
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
          <ItemDescription>
            {[
              account.planType?.toUpperCase(),
              resetCredits(account, language, t),
            ]
              .filter(Boolean)
              .join(" · ")}
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
