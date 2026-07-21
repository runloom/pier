import { Button } from "@pier/ui/button.tsx";
import { InputGroupTextarea } from "@pier/ui/input-group.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ArrowUp, Plus } from "lucide-react";
import type {
  ClipboardEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  Ref,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import { TerminalComposerAttachmentRail } from "./terminal-composer-attachment-rail.tsx";
import type { ComposerAttachment } from "./terminal-composer-attachments-model.ts";
import {
  TERMINAL_COMPOSER_GAP_PX,
  textareaSoftWrapped,
} from "./terminal-composer-helpers.ts";

/** Shared attach control — compact row and expanded footer must stay identical. */
function ComposerAttachButton({
  className,
  disabled,
  onClick,
}: {
  className?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <Button
      aria-label={t("terminal.composer.attachFile")}
      className={className}
      data-testid="terminal-composer-attach"
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      type="button"
      variant="secondary"
    >
      <Plus data-icon />
    </Button>
  );
}

export interface TerminalComposerViewProps {
  attachments: readonly ComposerAttachment[];
  bottomOffsetPx: number;
  canSend: boolean;
  compact: boolean;
  composingRef: { current: boolean };
  disabled: boolean;
  hasAttachments: boolean;
  onChromeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent) => void;
  onPickFiles: () => void;
  onRemoveAttachment: (id: string) => void;
  onRevealPath: (path: string) => void;
  onSend: () => void;
  onSetSoftWrapped: (wrapped: boolean) => void;
  onValueChange: (value: string) => void;
  overlayId: string;
  setRootRef: (el: HTMLDivElement | null) => void;
  textareaRef: Ref<HTMLTextAreaElement>;
  value: string;
}

export function TerminalComposerView({
  attachments,
  bottomOffsetPx,
  canSend,
  compact,
  composingRef,
  disabled,
  hasAttachments,
  onChromeMouseDown,
  onDragOver,
  onDrop,
  onKeyDown,
  onPaste,
  onPickFiles,
  onRemoveAttachment,
  onRevealPath,
  onSend,
  onSetSoftWrapped,
  onValueChange,
  overlayId,
  setRootRef,
  textareaRef,
  value,
}: TerminalComposerViewProps) {
  const t = useT();

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: drop target for attachment files
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for attachment files
    <div
      className="absolute inset-x-2 z-20"
      onDragOver={onDragOver}
      onDrop={onDrop}
      ref={setRootRef}
      style={{ bottom: bottomOffsetPx + TERMINAL_COMPOSER_GAP_PX }}
    >
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: chrome mousedown focuses textarea */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: chrome mousedown focuses textarea */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: labelled region for composer chrome */}
      <div
        aria-label={t("terminal.composer.label")}
        className={cn(
          "flex w-full min-w-0 border bg-input/50",
          "text-foreground shadow-lg outline-none",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
          compact
            ? "flex-row items-center gap-1 rounded-full px-1"
            : "flex-col rounded-2xl"
        )}
        data-chrome={compact ? "compact" : "expanded"}
        data-testid="terminal-composer"
        onMouseDown={onChromeMouseDown}
      >
        {!compact && hasAttachments ? (
          <div className="px-2 pt-2 pb-0.5">
            <TerminalComposerAttachmentRail
              attachments={attachments}
              disabled={disabled}
              onRemove={onRemoveAttachment}
              onReveal={onRevealPath}
            />
          </div>
        ) : null}

        {compact ? (
          <ComposerAttachButton
            className="shrink-0"
            disabled={disabled}
            onClick={onPickFiles}
          />
        ) : null}

        <InputGroupTextarea
          className={cn(
            "field-sizing-content w-full min-w-0 font-mono text-sm leading-5",
            "placeholder:text-muted-foreground/65",
            compact
              ? "max-h-9 min-h-9 flex-1 py-2 pr-1 pl-1"
              : cn(
                  "max-h-48 min-h-5 px-3",
                  hasAttachments ? "pt-2 pb-1.5" : "pt-2.5 pb-1.5"
                )
          )}
          data-testid="terminal-composer-input"
          disabled={disabled}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onCompositionEnd={() => {
            composingRef.current = false;
            const el =
              typeof textareaRef === "object" && textareaRef
                ? textareaRef.current
                : null;
            if (el) {
              onSetSoftWrapped(textareaSoftWrapped(el));
            }
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onFocus={() => useTerminalStore.getState().activateOverlay(overlayId)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={t("terminal.composer.placeholder")}
          ref={textareaRef}
          rows={1}
          value={value}
        />

        {compact ? (
          <Button
            aria-label={t("terminal.composer.send")}
            className="mr-0.5 shrink-0 rounded-full"
            data-testid="terminal-composer-send"
            disabled={!canSend}
            onClick={onSend}
            size="icon-sm"
            variant="default"
          >
            <ArrowUp />
          </Button>
        ) : (
          <div className="flex shrink-0 items-center gap-1 px-1 pt-0.5 pb-1">
            <ComposerAttachButton disabled={disabled} onClick={onPickFiles} />
            <div className="min-w-0 flex-1" />
            <span
              aria-hidden="true"
              className="shrink-0 text-[10px] text-muted-foreground/60"
            >
              {t("terminal.composer.keyHint")}
            </span>
            <Button
              aria-label={t("terminal.composer.send")}
              className="rounded-full"
              data-testid="terminal-composer-send"
              disabled={!canSend}
              onClick={onSend}
              size="sm"
              variant="default"
            >
              {t("terminal.composer.send")}
              <Kbd className="h-4 bg-action-accent-foreground/20 text-[10px] text-action-accent-foreground">
                ⏎
              </Kbd>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
