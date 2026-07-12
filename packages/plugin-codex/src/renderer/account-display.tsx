import { Avatar, AvatarFallback } from "@pier/ui/avatar.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
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
      className={compact ? "pier-codex-mini-quota" : "pier-codex-quota"}
      data-risk={risk}
      data-slot="codex-usage-progress"
    >
      <div className="pier-codex-quota-heading">
        <span>{label}</span>
        <strong>{formatPercent(remaining / 100, language)}</strong>
      </div>
      <Progress
        aria-label={`${label} ${formatPercent(remaining / 100, language)}`}
        className={compact ? "codex:h-1" : "codex:h-1.5"}
        value={remaining}
        variant={usageProgressVariant(risk)}
      />
      <div className="pier-codex-quota-meta">
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
  t,
  windows,
}: {
  compact?: boolean;
  error: string | undefined;
  language: string;
  t: Translate;
  windows: CodexUsageWindow[];
}): JSX.Element {
  const errorState = error ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className="codex:col-span-full codex:justify-self-start"
            role="status"
            tabIndex={0}
            variant="danger"
          >
            {t(
              "pier.codex.accounts.settings.usageFailed",
              "Usage update failed"
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="codex:max-w-80">{error}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;

  if (windows.length === 0) {
    return (
      <div className="pier-codex-quota-empty">
        {errorState ??
          t("pier.codex.accounts.settings.noUsage", "No usage data")}
      </div>
    );
  }

  return (
    <div
      className={compact ? "pier-codex-mini-quotas" : "pier-codex-quota-grid"}
      data-count={windows.length}
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
      {errorState}
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
              spinning && "codex:animate-spin codex:motion-reduce:animate-none"
            )}
            data-icon="inline-start"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
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
    <Item asChild className="pier-codex-account-row" size="sm">
      <li data-testid="codex-account-usage-row">
        <ItemMedia align="center">
          <AccountAvatar label={account.label} />
        </ItemMedia>
        <ItemContent className="codex:min-w-0">
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
