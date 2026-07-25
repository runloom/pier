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
import type { TuiSendBlockReason } from "./tui-input-focus.ts";

/** 发送按钮 + 阻断提示：阻断时 tooltip 受控常开（非 hover），锚在按钮上方。 */
export function SendButtonWithBlockHint({
  blockReason,
  canSend,
  compact,
  onSend,
}: {
  blockReason: TuiSendBlockReason | null;
  canSend: boolean;
  compact: boolean;
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
  if (blockReason === null) {
    return button;
  }
  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <span className="shrink-0">{button}</span>
        </TooltipTrigger>
        <TooltipContent
          data-testid="terminal-composer-send-block"
          sideOffset={6}
        >
          {blockReason === "waiting"
            ? t("terminal.composer.blockedWaiting")
            : t("terminal.composer.blockedUnfocused")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
