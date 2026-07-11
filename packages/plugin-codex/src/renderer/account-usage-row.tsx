import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { formatRelativeTime } from "@pier/ui/format.tsx";
import { TableCell, TableRow } from "@pier/ui/table.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils";
import {
  ArrowRightLeft,
  type LucideIcon,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { JSX } from "react";
import type {
  CodexAccountStatus,
  CodexUsageSnapshot,
} from "../shared/accounts.ts";
import { UsageMeter } from "./usage-meter.tsx";

export type Translate = (key: string, fallback: string) => string;

function statusBadge(
  isSystemDefault: boolean,
  status: CodexAccountStatus,
  t: Translate
): JSX.Element | null {
  if (isSystemDefault) {
    return (
      <Badge variant="secondary">
        {t("pier.codex.accounts.settings.systemDefault", "System default")}
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive">
        {t("pier.codex.accounts.settings.status.error", "Error")}
      </Badge>
    );
  }
  if (status === "login-pending") {
    return (
      <Badge variant="outline">
        {t(
          "pier.codex.accounts.settings.status.login-pending",
          "Login pending"
        )}
      </Badge>
    );
  }
  return null;
}

function AccountAction({
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: (() => void) | undefined;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          data-account-action=""
          disabled={disabled}
          onClick={() => onClick?.()}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface AccountUsageRowProps {
  description: string | undefined;
  isSystemDefault: boolean;
  label: string;
  language: string;
  onRefresh: () => void;
  onRemove: (() => void) | undefined;
  onSelect: (() => void) | undefined;
  planType: string | undefined;
  status: CodexAccountStatus;
  t: Translate;
  usage: CodexUsageSnapshot | null | undefined;
}

export function AccountUsageRow({
  description,
  isSystemDefault,
  label,
  language,
  onRefresh,
  onRemove,
  onSelect,
  planType,
  status,
  t,
  usage,
}: AccountUsageRowProps): JSX.Element {
  const hasUsage = usage?.status === "ok" && (usage.session || usage.weekly);
  const updated = usage
    ? formatRelativeTime(usage.fetchedAt, Date.now(), language)
    : null;

  return (
    <TableRow
      className="pier-codex-account-row"
      data-current={isSystemDefault}
      data-slot="codex-account-usage-row"
    >
      <TableCell className="pier-codex-account-cell">
        <div className="pier-codex-account-copy">
          <div className="pier-codex-account-title">
            <span className="truncate" title={label}>
              {label}
            </span>
            {statusBadge(isSystemDefault, status, t)}
          </div>
          {description ? (
            <p
              className="truncate text-destructive text-xs"
              title={description}
            >
              {description}
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="pier-codex-plan-cell">
        {planType ? (
          <Badge variant="outline">{planType.toUpperCase()}</Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="pier-codex-account-usage-cell">
        <div className="pier-codex-account-usage">
          {hasUsage ? (
            <UsageMeter
              language={language}
              session={usage.session}
              t={t}
              weekly={usage.weekly}
            />
          ) : (
            <span
              className={cn(
                "text-xs",
                usage?.status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {usage?.status === "error"
                ? t(
                    "pier.codex.accounts.settings.usageFailed",
                    "Usage update failed"
                  )
                : t("pier.codex.accounts.settings.noUsage", "No usage data")}
            </span>
          )}
          {updated ? (
            <span className="pier-codex-account-updated">
              {t("pier.codex.accounts.settings.updated", "Updated")} {updated}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="pier-codex-actions-cell">
        <TooltipProvider delayDuration={200}>
          <div className="pier-codex-account-actions">
            <AccountAction
              disabled={!onSelect}
              icon={ArrowRightLeft}
              label={`${t("pier.codex.accounts.settings.switch", "Switch")}: ${label}`}
              onClick={onSelect}
            />
            <AccountAction
              icon={RefreshCw}
              label={`${t("pier.codex.accounts.settings.refreshUsage", "Refresh usage")}: ${label}`}
              onClick={onRefresh}
            />
            <AccountAction
              disabled={!onRemove}
              icon={Trash2}
              label={`${t("pier.codex.accounts.settings.remove", "Remove")}: ${label}`}
              onClick={onRemove}
            />
          </div>
        </TooltipProvider>
      </TableCell>
    </TableRow>
  );
}
