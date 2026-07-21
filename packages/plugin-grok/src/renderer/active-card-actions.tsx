import { Button } from "@pier/ui/button.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { RefreshCw, Share2, Trash2 } from "lucide-react";
import type { JSX } from "react";
import type { Translate } from "./format-account-error.ts";

/** Active-card action cluster: peer sync (optional) + refresh + remove. */
export function ActiveCardActions({
  activeLabel,
  onRefresh,
  onRemove,
  onSyncPeers,
  refreshing,
  removeDisabled,
  showSyncPeers,
  t,
}: {
  activeLabel: string;
  onRefresh: () => void;
  onRemove: () => void;
  onSyncPeers: () => void;
  refreshing: boolean;
  removeDisabled: boolean;
  showSyncPeers: boolean;
  t: Translate;
}): JSX.Element {
  return (
    <TooltipProvider delayDuration={200}>
      {showSyncPeers ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t(
                "pier.grok.accounts.settings.syncPeers",
                "Sync to other tools"
              )}
              onClick={onSyncPeers}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Share2 data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent data-pier-grok-scope="">
            {t("pier.grok.accounts.settings.syncPeers", "Sync to other tools")}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-busy={refreshing || undefined}
            aria-label={t(
              "pier.grok.accounts.settings.refreshUsage",
              "Refresh usage"
            )}
            disabled={refreshing}
            onClick={onRefresh}
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
        </TooltipTrigger>
        <TooltipContent data-pier-grok-scope="">
          {t("pier.grok.accounts.settings.refreshUsage", "Refresh usage")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={`${t("pier.grok.accounts.settings.remove", "Remove")}: ${activeLabel}`}
            disabled={removeDisabled}
            onClick={onRemove}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 data-icon="inline-start" />
          </Button>
        </TooltipTrigger>
        <TooltipContent data-pier-grok-scope="">
          {t("pier.grok.accounts.settings.remove", "Remove")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
