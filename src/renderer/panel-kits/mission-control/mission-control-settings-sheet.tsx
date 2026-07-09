import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pier/ui/sheet.tsx";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import { useT } from "@/i18n/use-t.ts";
import type { ResolvedMissionControlWidget } from "./mission-control-merge.ts";

interface MissionControlSettingsSheetProps {
  onOpenChange: (open: boolean) => void;
  updateParams: (patch: Record<string, JsonValue>) => void;
  widget: ResolvedMissionControlWidget | null;
}

/**
 * 物料设置宿主：Sheet 内嵌物料自带的 settingsComponent。
 * 写回统一走 updateParams（随 panel params 持久化），宿主不解释配置内容。
 */
export function MissionControlSettingsSheet({
  onOpenChange,
  updateParams,
  widget,
}: MissionControlSettingsSheetProps) {
  const t = useT();
  const SettingsComponent = widget?.registration?.settingsComponent;
  let title = "";
  if (widget !== null) {
    title = widget.status === "core" ? t(widget.title) : widget.title;
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={widget !== null}>
      <SheetContent
        className="w-96 sm:max-w-96"
        data-testid="mission-control-widget-settings-sheet"
        side="right"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {t("missionControl.widget.settingsDescription")}
          </SheetDescription>
        </SheetHeader>
        {widget && SettingsComponent ? (
          <div
            className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
            data-scrollbar="stable"
          >
            <SettingsComponent
              instanceId={widget.instanceId}
              params={widget.params}
              updateParams={updateParams}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
