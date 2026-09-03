import { Button } from "@pier/ui/button.tsx";
import { OVERLAY_REGION_FOOTER_CLASS } from "@pier/ui/separator.tsx";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

export function CreateMenuManageAgents({
  onClose,
}: {
  onClose: () => void;
}): ReactNode {
  const t = useT();
  return (
    <div className={OVERLAY_REGION_FOOTER_CLASS}>
      <Button
        className="w-full justify-start font-normal"
        onClick={() => {
          onClose();
          useSettingsDialogStore.getState().openSection("agents");
        }}
        type="button"
        variant="ghost"
      >
        {t("workspace.addPanelMenu.manageAgents")}
      </Button>
    </div>
  );
}
