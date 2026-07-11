import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Input } from "@pier/ui/input.tsx";
import { Toggle } from "@pier/ui/toggle.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ArrowDown, ArrowUp, CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

export interface FilesSearchBarLabels {
  close: string;
  matchCase?: string;
  next: string;
  open?: string;
  placeholder: string;
  previous: string;
  regexp?: string;
  replace?: string;
  replaceAll?: string;
  replacePlaceholder?: string;
  selectAll?: string;
  wholeWord?: string;
}

export type FilesSearchOptionKey = "caseSensitive" | "regexp" | "wholeWord";

export interface FilesSearchOptions {
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

/**
 * files 插件统一搜索栏(编辑器内查找 + 树内查找共用),视觉语言对齐终端
 * 搜索栏(rounded-full 胶囊 + 前缀图标 input + 计数 Badge + ghost 导航钮)。
 * 定位由调用方经 className 决定:编辑器用 absolute 浮层,树用行内条。
 */
export function FilesSearchBar({
  className,
  focusSignal,
  labels,
  matchText,
  navigationDisabled = false,
  onChange,
  onClose,
  onNavigate,
  onOptionChange,
  onReplace,
  onReplaceAll,
  onReplaceChange,
  onSelectAll,
  onSubmit,
  options,
  readOnly = false,
  replaceValue = "",
  testId,
  submitDisabled = false,
  value,
}: {
  className?: string;
  /** 单调递增;变化时聚焦并全选输入框。 */
  focusSignal: number;
  labels: FilesSearchBarLabels;
  /** 空字符串 = 不显示计数。 */
  matchText: string;
  navigationDisabled?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onNavigate: (direction: "next" | "previous") => void;
  onOptionChange?: (key: FilesSearchOptionKey, value: boolean) => void;
  onReplace?: () => void;
  onReplaceAll?: () => void;
  onReplaceChange?: (value: string) => void;
  onSelectAll?: () => void;
  /** 提供时，Enter/回车按钮提交当前匹配；方向键负责切换匹配。 */
  onSubmit?: () => void;
  options?: FilesSearchOptions;
  readOnly?: boolean;
  replaceValue?: string;
  testId?: string;
  submitDisabled?: boolean;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceLabel = labels.replacePlaceholder ?? "Replace";
  const supportsReplace =
    onReplaceChange || onReplace || onReplaceAll || onSelectAll || options;

  useEffect(() => {
    if (focusSignal <= 0) {
      return;
    }
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [focusSignal]);

  return (
    <search
      aria-label={labels.placeholder}
      className={cn(
        "pointer-events-auto flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-background/40 shadow-lg",
        className
      )}
      {...(testId ? { "data-testid": testId } : {})}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <div className="relative min-w-0 flex-1 basis-36">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={labels.placeholder}
            className="h-7 rounded-lg border-transparent bg-muted/45 pr-2 pl-7 text-xs placeholder:text-muted-foreground/65"
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (onSubmit) {
                  if (!submitDisabled) {
                    onSubmit();
                  }
                } else {
                  onNavigate(event.shiftKey ? "previous" : "next");
                }
              } else if (
                onSubmit &&
                !navigationDisabled &&
                event.key === "ArrowDown"
              ) {
                event.preventDefault();
                onNavigate("next");
              } else if (
                onSubmit &&
                !navigationDisabled &&
                event.key === "ArrowUp"
              ) {
                event.preventDefault();
                onNavigate("previous");
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder={labels.placeholder}
            ref={inputRef}
            type="text"
            value={value}
          />
        </div>
        <div
          className="ml-auto flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-1"
          data-slot="files-search-controls"
        >
          {matchText ? (
            <Badge
              className="h-6 min-w-0 max-w-24 shrink rounded-lg px-2 text-muted-foreground tabular-nums"
              title={matchText}
              variant="secondary"
            >
              <span className="truncate">{matchText}</span>
            </Badge>
          ) : null}
          <Button
            aria-label={labels.previous}
            className="shrink-0 rounded-lg"
            disabled={navigationDisabled}
            onClick={() => onNavigate("previous")}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <ArrowUp />
          </Button>
          <Button
            aria-label={labels.next}
            className="shrink-0 rounded-lg"
            disabled={navigationDisabled}
            onClick={() => onNavigate("next")}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <ArrowDown />
          </Button>
          {onSubmit ? (
            <Button
              aria-label={labels.open ?? "Open match"}
              className="shrink-0 rounded-lg"
              disabled={submitDisabled}
              onClick={onSubmit}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <CornerDownLeft />
            </Button>
          ) : null}
          <Button
            aria-label={labels.close}
            className="shrink-0 rounded-lg"
            onClick={onClose}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
      </div>
      {supportsReplace ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Input
            aria-label={replaceLabel}
            className="h-7 min-w-28 flex-1 rounded-lg border-transparent bg-muted/45 text-xs placeholder:text-muted-foreground/65"
            disabled={readOnly}
            onChange={(event) => onReplaceChange?.(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) {
                  onReplaceAll?.();
                } else {
                  onReplace?.();
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder={replaceLabel}
            type="text"
            value={replaceValue}
          />
          <Button
            aria-label={labels.replace ?? "Replace"}
            disabled={readOnly}
            onClick={onReplace}
            size="xs"
            type="button"
            variant="secondary"
          >
            {labels.replace ?? "Replace"}
          </Button>
          <Button
            aria-label={labels.replaceAll ?? "Replace all"}
            disabled={readOnly}
            onClick={onReplaceAll}
            size="xs"
            type="button"
            variant="secondary"
          >
            {labels.replaceAll ?? "Replace all"}
          </Button>
          <Button
            aria-label={labels.selectAll ?? "Select all matches"}
            onClick={onSelectAll}
            size="xs"
            type="button"
            variant="ghost"
          >
            {labels.selectAll ?? "All"}
          </Button>
          {options ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Toggle
                aria-label={labels.matchCase ?? "Match case"}
                className="h-6 min-w-7 rounded-lg px-1.5 font-mono text-[11px]"
                onPressedChange={(pressed) =>
                  onOptionChange?.("caseSensitive", pressed)
                }
                pressed={options.caseSensitive}
                size="sm"
                title={labels.matchCase ?? "Match case"}
                type="button"
              >
                Aa
              </Toggle>
              <Toggle
                aria-label={labels.regexp ?? "Regexp"}
                className="h-6 min-w-7 rounded-lg px-1.5 font-mono text-[11px]"
                onPressedChange={(pressed) =>
                  onOptionChange?.("regexp", pressed)
                }
                pressed={options.regexp}
                size="sm"
                title={labels.regexp ?? "Regexp"}
                type="button"
              >
                .*
              </Toggle>
              <Toggle
                aria-label={labels.wholeWord ?? "Whole word"}
                className="h-6 min-w-7 rounded-lg px-1.5 font-mono text-[11px]"
                onPressedChange={(pressed) =>
                  onOptionChange?.("wholeWord", pressed)
                }
                pressed={options.wholeWord}
                size="sm"
                title={labels.wholeWord ?? "Whole word"}
                type="button"
              >
                W
              </Toggle>
            </div>
          ) : null}
        </div>
      ) : null}
    </search>
  );
}
