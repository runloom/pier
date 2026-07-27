import { Button } from "@pier/ui/button.tsx";
import { DIALOG_FOOTER_ACTIONS_CLASS } from "@pier/ui/dialog-form-layout.ts";
import type { ReactNode } from "react";

export interface ContentDialogFooterActionsProps {
  cancelDisabled?: boolean;
  cancelLabel: string;
  confirmDisabled?: boolean;
  confirmFormId?: string;
  confirmLabel: string;
  /** When set, confirm is a form submit button bound to this form id. */
  confirmLoading?: boolean;
  confirmVariant?: "default" | "destructive";
  /** Extra actions between cancel and confirm (rare). */
  middle?: ReactNode;
  onCancel: () => void;
  onConfirm?: () => void;
}

/**
 * Canonical content-dialog sticky footer: `取消 | 主按钮`（主按钮最右）.
 * Prefer this over ad-hoc body footers so shell chrome stays host-owned.
 */
export function ContentDialogFooterActions({
  cancelDisabled,
  cancelLabel,
  confirmDisabled,
  confirmFormId,
  confirmLabel,
  confirmLoading,
  confirmVariant = "default",
  middle,
  onCancel,
  onConfirm,
}: ContentDialogFooterActionsProps) {
  return (
    <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
      <Button
        disabled={cancelDisabled || confirmLoading}
        onClick={onCancel}
        type="button"
        variant="outline"
      >
        {cancelLabel}
      </Button>
      {middle}
      <Button
        disabled={confirmDisabled || confirmLoading}
        form={confirmFormId}
        onClick={confirmFormId ? undefined : onConfirm}
        type={confirmFormId ? "submit" : "button"}
        variant={confirmVariant}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}
