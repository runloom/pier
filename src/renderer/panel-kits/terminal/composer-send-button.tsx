import { Button } from "@pier/ui/button.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { ArrowUp } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import type { TuiInputFocusRisk } from "./hooks/use-tui-input-focus-risk.ts";

/**
 * 发送按钮 + 输入聚焦风险提示。
 * 有风险时用受控 Tooltip 锚在按钮上（Portal，不裁切；箭头指向发送按钮）。
 * Esc 关增强输入由 composer 自理（不再因 defaultPrevented 放弃关闭）。
 */
export function SendButtonWithBlockHint({
  canSend,
  compact,
  inputFocusRisk,
  onSend,
}: {
  canSend: boolean;
  compact: boolean;
  inputFocusRisk: TuiInputFocusRisk | null;
  onSend: () => void;
}) {
  const t = useT();
  const button = compact ? (
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
  );

  if (inputFocusRisk === null) {
    return button;
  }

  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0">{button}</span>
        </TooltipTrigger>
        <TooltipContent
          data-testid="terminal-composer-send-block"
          side="top"
          sideOffset={6}
        >
          {t("terminal.composer.blockedUnfocused")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
