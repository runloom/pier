import { Button } from "@pier/ui/button.tsx";
import { useMinSpinVisual } from "@pier/ui/hooks/use-min-spin.ts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@pier/ui/select.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ChevronDown, Columns2, List, RefreshCw } from "lucide-react";
import type { JSX, ReactNode } from "react";
import type { TaskProvider } from "../shared/types.ts";
import type { Translate } from "./translate.ts";

type TrackerView = "board" | "list";

const SOURCES: TaskProvider[] = ["github", "linear", "jira"];

export function sourceLabel(source: TaskProvider, t: Translate): string {
  if (source === "linear") {
    return t("pier.tasks.panel.sourceLinear", "Linear");
  }
  if (source === "jira") {
    return t("pier.tasks.panel.sourceJira", "Jira");
  }
  return t("pier.tasks.panel.sourceGithub", "GitHub Issues");
}

export function TaskPanelHeader({
  center,
  disabled,
  onRefresh,
  onSourceChange,
  onViewChange,
  refreshing = false,
  source,
  t,
  view,
}: {
  center?: ReactNode;
  disabled: boolean;
  onRefresh: () => void;
  onSourceChange: (source: TaskProvider) => void;
  onViewChange: (view: TrackerView) => void;
  refreshing?: boolean;
  source: TaskProvider;
  t: Translate;
  view: TrackerView;
}): JSX.Element {
  const spinRefresh = useMinSpinVisual(refreshing);
  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <header
        className="flex h-10 shrink-0 items-center gap-2 border-border border-b bg-background px-2"
        data-slot="file-panel-header"
      >
        <div className="flex min-w-0 items-center">
          <HeaderMenu
            items={SOURCES.map((item) => ({
              label: sourceLabel(item, t),
              value: item,
            }))}
            label={t("pier.tasks.panel.source", "Tracker")}
            onChange={(value) => {
              if (
                value === "github" ||
                value === "linear" ||
                value === "jira"
              ) {
                onSourceChange(value);
              }
            }}
            value={source}
            valueLabel={sourceLabel(source, t)}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {center ?? null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <HeaderIconButton
            label={
              view === "board"
                ? t("pier.tasks.panel.switchToList", "Switch to list")
                : t("pier.tasks.panel.switchToBoard", "Switch to board")
            }
            onClick={() => onViewChange(view === "board" ? "list" : "board")}
          >
            {view === "board" ? <Columns2 data-icon /> : <List data-icon />}
          </HeaderIconButton>
          <HeaderIconButton
            busy={refreshing}
            disabled={disabled || refreshing}
            label={t("pier.tasks.panel.refresh", "Refresh")}
            onClick={onRefresh}
          >
            <RefreshCw
              className={cn(spinRefresh && "animate-spin")}
              data-icon
            />
          </HeaderIconButton>
        </div>
      </header>
    </TooltipProvider>
  );
}

export function HeaderMenu({
  disabled,
  items,
  label,
  onChange,
  value,
  valueLabel,
}: {
  disabled?: boolean;
  items: readonly { label: string; value: string }[];
  label: string;
  onChange: (value: string) => void;
  value: string;
  valueLabel: string;
}): JSX.Element {
  const selected = items.some((item) => item.value === value)
    ? value
    : (items[0]?.value ?? value);
  return (
    <Select onValueChange={onChange} value={selected}>
      <SelectTrigger aria-label={label} asChild>
        <Button
          className="min-w-0 max-w-48"
          disabled={disabled || items.length === 0}
          size="xs"
          type="button"
          variant="ghost"
        >
          <span className="min-w-0 truncate">{valueLabel}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </SelectTrigger>
      <SelectContent align="start" position="popper">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function HeaderIconButton({
  busy,
  children,
  disabled,
  label,
  onClick,
  pressed,
}: {
  busy?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            aria-busy={busy || undefined}
            aria-label={label}
            {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
            disabled={disabled}
            onClick={onClick}
            size="icon-xs"
            type="button"
            variant={pressed ? "secondary" : "ghost"}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent align="center" side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
