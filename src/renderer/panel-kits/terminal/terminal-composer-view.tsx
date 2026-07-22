import { Button } from "@pier/ui/button.tsx";
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
import { useMemo } from "react";
import { useT } from "@/i18n/use-t.ts";
import { formatChord } from "@/lib/keybindings/formatter.ts";
import { isMac } from "@/lib/keybindings/matcher.ts";
import { parseChord } from "@/lib/keybindings/parse.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import type { StructuredComposerEditorHandle } from "./structured-composer/structured-composer-editor.tsx";
import { StructuredComposerEditor } from "./structured-composer/structured-composer-editor.tsx";
import { TerminalComposerAttachmentRail } from "./terminal-composer-attachment-rail.tsx";
import type { ComposerAttachment } from "./terminal-composer-attachments-model.ts";
import {
  elementSoftWrapped,
  TERMINAL_COMPOSER_GAP_PX,
} from "./terminal-composer-helpers.ts";

const COMPOSER_ATTACH_CHORD = "Mod+Shift+KeyA";

/** Shared attach control — compact row and expanded footer must stay identical. */
function ComposerAttachButton({
  className,
  disabled,
  onClick,
  shortcutLabel,
}: {
  className?: string;
  disabled: boolean;
  onClick: () => void;
  shortcutLabel: string;
}) {
  const t = useT();
  const label = t("terminal.composer.attachFile");
  return (
    <Button
      aria-keyshortcuts={shortcutLabel}
      aria-label={`${label} (${shortcutLabel})`}
      className={className}
      data-testid="terminal-composer-attach"
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={`${label} (${shortcutLabel})`}
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
  editorRef: Ref<StructuredComposerEditorHandle>;
  hasAttachments: boolean;
  onChromeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onLargePlainPaste: (text: string) => void;
  onPaste: (event: ClipboardEvent) => void;
  onPickFiles: () => void;
  onRemoveAttachment: (id: string) => void;
  onRevealPath: (path: string) => void;
  onSend: () => void;
  onSetSoftWrapped: (wrapped: boolean) => void;
  onValueChange: (value: string) => void;
  overlayId: string;
  projectRootPath: string | null;
  setRootRef: (el: HTMLDivElement | null) => void;
  value: string;
}

export function TerminalComposerView({
  attachments,
  bottomOffsetPx,
  canSend,
  compact,
  composingRef,
  disabled,
  editorRef,
  hasAttachments,
  onChromeMouseDown,
  onDragOver,
  onDrop,
  onKeyDown,
  onPaste,
  onLargePlainPaste,
  onPickFiles,
  onRemoveAttachment,
  onRevealPath,
  onSend,
  onSetSoftWrapped,
  onValueChange,
  overlayId,
  projectRootPath,
  setRootRef,
  value,
}: TerminalComposerViewProps) {
  const t = useT();
  const attachShortcut = useMemo(
    () => formatChord(parseChord(COMPOSER_ATTACH_CHORD, isMac())),
    []
  );

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
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: chrome mousedown focuses editor */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: chrome mousedown focuses editor */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: labelled region for composer chrome */}
      <div
        aria-label={t("terminal.composer.label")}
        className={cn(
          "flex w-full min-w-0 border bg-background",
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
            shortcutLabel={attachShortcut}
          />
        ) : null}

        <StructuredComposerEditor
          attachments={attachments}
          className={cn(
            compact
              ? // Keep compact chrome min height (36px); do not clip @/# menus
                // (menus portal to body; overflow-x still contained by chrome).
                "h-9 max-h-9 min-h-9 min-w-0 flex-1 pr-1 pl-1"
              : cn(
                  "max-h-48 min-h-5 px-3",
                  hasAttachments ? "pt-2 pb-1.5" : "pt-2 pb-1.5"
                )
          )}
          compact={compact}
          disabled={disabled}
          onCompositionEnd={() => {
            composingRef.current = false;
            const el =
              typeof editorRef === "object" && editorRef
                ? editorRef.current?.getElement()
                : null;
            if (el) {
              onSetSoftWrapped(elementSoftWrapped(el));
            }
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onFocus={() => {
            useTerminalStore.getState().activateOverlay(overlayId);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              composingRef.current = true;
            } else {
              composingRef.current = false;
            }
            onKeyDown(event);
            if (!composingRef.current) {
              const el =
                typeof editorRef === "object" && editorRef
                  ? editorRef.current?.getElement()
                  : null;
              if (el) {
                onSetSoftWrapped(elementSoftWrapped(el));
              }
            }
          }}
          onLargePlainPaste={onLargePlainPaste}
          onPaste={onPaste}
          onSend={onSend}
          onValueChange={onValueChange}
          placeholder={t("terminal.composer.placeholder")}
          projectRootPath={projectRootPath}
          ref={editorRef}
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
            <ArrowUp data-icon />
          </Button>
        ) : (
          <div className="flex shrink-0 items-center gap-1 px-1 pt-0.5 pb-1">
            <ComposerAttachButton
              disabled={disabled}
              onClick={onPickFiles}
              shortcutLabel={attachShortcut}
            />
            <div className="min-w-0 flex-1" />
            <span
              aria-hidden="true"
              className="shrink-0 text-[10px] text-muted-foreground/60"
            >
              {t("terminal.composer.keyHint", { attach: attachShortcut })}
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
