import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/primitives/button.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/primitives/input-group.tsx";
import { Kbd, KbdGroup } from "@/components/primitives/kbd.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/primitives/tooltip.tsx";
import { cn } from "@/utils/index.ts";

interface ShortcutInputProps {
  canClear?: boolean;
  canReset?: boolean;
  className?: string;
  clearLabel: string;
  isRecording?: boolean;
  keyParts?: readonly string[];
  onCancelRecord: () => void;
  onClear: () => void;
  onRecord: () => void;
  onReset: () => void;
  placeholder: string;
  recordingLabel: string;
  recordLabel: string;
  resetLabel: string;
  tooltipLabel: string;
}

export function ShortcutInput({
  canClear = true,
  canReset = true,
  className,
  clearLabel,
  isRecording = false,
  keyParts = [],
  onClear,
  onCancelRecord,
  onRecord,
  onReset,
  placeholder,
  recordLabel,
  recordingLabel,
  resetLabel,
  tooltipLabel,
}: ShortcutInputProps) {
  const recordingButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isRecording) {
      recordingButtonRef.current?.focus();
    }
  }, [isRecording]);

  if (isRecording) {
    return (
      <Button
        aria-label={recordLabel}
        aria-pressed="true"
        className={cn(
          "h-8 w-44 rounded-2xl border-1 border-muted-foreground/40 bg-background px-4 text-muted-foreground shadow-[0_0_0_4px_var(--muted)] hover:bg-background hover:text-muted-foreground",
          className
        )}
        data-recording="true"
        data-slot="shortcut-input"
        data-testid="shortcut-input"
        onBlur={onCancelRecord}
        onClick={onRecord}
        ref={recordingButtonRef}
        type="button"
        variant="outline"
      >
        {recordingLabel}
      </Button>
    );
  }

  return (
    <InputGroup
      className={cn(
        "h-8 w-56 rounded-2xl border-input bg-background/90 p-1 shadow-xs",
        className
      )}
      data-testid="shortcut-input"
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={recordLabel}
              aria-pressed="false"
              className="h-full min-w-0 flex-1 shrink justify-between rounded-xl px-2 text-left font-normal shadow-none hover:bg-muted/70 active:translate-y-0"
              data-slot="shortcut-input-trigger"
              onClick={onRecord}
              onFocus={onRecord}
              type="button"
              variant="ghost"
            >
              {keyParts.length > 0 ? (
                <KbdGroup className="min-w-0">
                  {keyParts.map((part, index) => (
                    <Kbd
                      className="h-5 min-w-5 rounded-md border border-border bg-muted/70 px-2 text-xs shadow-xs"
                      data-testid="shortcut-input-key"
                      key={`${part}-${index}`}
                    >
                      {part}
                    </Kbd>
                  ))}
                </KbdGroup>
              ) : (
                <span className="min-w-0 truncate text-muted-foreground">
                  {placeholder}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltipLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <InputGroupAddon
        align="inline-end"
        className="gap-0 p-0 pr-0 has-[>button]:mr-0"
      >
        <InputGroupButton
          aria-label={clearLabel}
          disabled={!canClear}
          onClick={onClear}
          size="icon-sm"
        >
          <X />
        </InputGroupButton>
        <InputGroupButton
          aria-label={resetLabel}
          disabled={!canReset}
          onClick={onReset}
          size="icon-sm"
        >
          <RotateCcw />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
