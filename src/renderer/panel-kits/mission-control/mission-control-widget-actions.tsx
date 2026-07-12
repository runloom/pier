import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import type { LucideIcon } from "lucide-react";
import { EllipsisVertical } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWidgetHeaderOverflow } from "./use-widget-header-overflow.ts";

export interface WidgetHeaderAction {
  disabled?: boolean;
  icon: LucideIcon;
  id: string;
  intent?: "default" | "destructive";
  invoke(): Promise<void> | void;
  label: string;
  priority: number;
  testId?: string;
}

function DirectAction({
  action,
  pending,
  run,
}: {
  action: WidgetHeaderAction;
  pending: boolean;
  run(action: WidgetHeaderAction): Promise<void>;
}) {
  const Icon = action.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-busy={pending || undefined}
          aria-label={action.label}
          data-testid={action.testId}
          disabled={action.disabled || pending}
          onClick={() => {
            run(action).catch(() => undefined);
          }}
          size="icon-xs"
          variant={action.intent === "destructive" ? "destructive" : "ghost"}
        >
          {pending ? (
            <Spinner aria-label={action.label} data-icon="inline-start" />
          ) : (
            <Icon data-icon="inline-start" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  );
}

export function MissionControlWidgetActions({
  actions,
}: {
  actions: readonly WidgetHeaderAction[];
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [headerRef, visibleCount, measured] = useWidgetHeaderOverflow(
    actions.length,
    menuOpen
  );
  const direct = actions.slice(0, visibleCount);
  const overflow = actions.slice(visibleCount);

  const run = async (action: WidgetHeaderAction): Promise<void> => {
    if (action.disabled || pendingIds.has(action.id)) return;
    setPendingIds((current) => new Set(current).add(action.id));
    try {
      await action.invoke();
    } catch (error) {
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: t("missionControl.widget.actionFailed"),
      });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(action.id);
        return next;
      });
    }
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className="relative flex min-w-0 items-center justify-end gap-1"
        data-slot="mission-control-widget-actions"
        ref={headerRef}
      >
        <div
          aria-hidden="true"
          className="invisible absolute flex items-center gap-1"
          data-slot="mission-control-widget-action-measurement"
        >
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                data-measure-action=""
                key={action.id}
                size="icon-xs"
                tabIndex={-1}
                variant="ghost"
              >
                <Icon data-icon="inline-start" />
              </Button>
            );
          })}
          <Button
            data-measure-more=""
            size="icon-xs"
            tabIndex={-1}
            variant="ghost"
          >
            <EllipsisVertical data-icon="inline-start" />
          </Button>
        </div>
        <div
          className="flex items-center gap-1"
          data-slot="mission-control-widget-action-display"
          style={{ visibility: measured ? "visible" : "hidden" }}
        >
          {direct.map((action) => (
            <DirectAction
              action={action}
              key={action.id}
              pending={pendingIds.has(action.id)}
              run={run}
            />
          ))}
          {overflow.length > 0 ? (
            <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t("missionControl.widget.menu")}
                  data-testid="mission-control-widget-menu-trigger"
                  size="icon-xs"
                  variant="ghost"
                >
                  <EllipsisVertical data-icon="inline-start" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                  {overflow.map((action) => {
                    const Icon = action.icon;
                    const pending = pendingIds.has(action.id);
                    return (
                      <DropdownMenuItem
                        data-testid={action.testId}
                        disabled={action.disabled || pending}
                        key={action.id}
                        onSelect={() => {
                          run(action).catch(() => undefined);
                        }}
                        variant={
                          action.intent === "destructive"
                            ? "destructive"
                            : "default"
                        }
                      >
                        {pending ? <Spinner /> : <Icon />}
                        {action.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
