/**
 * Permanent placeholder panel used when a cross-window transfer target boots
 * and the source panel's component is no longer registered (e.g. its plugin
 * was disabled between the transfer being committed and the target window
 * restoring).
 *
 * The placeholder is itself a permanent core component (`panel-transfer-unavailable`)
 * so sanitizer / fromJSON accept it. The original panel descriptor is embedded
 * in params (`transferRole` + `originalDescriptor`) so a later load — once the
 * component returns — can restore the panel via
 * `panel-transfer-layout-rewrite.restoreEmbeddedTransferPanels`.
 */

import type { IDockviewPanelProps } from "dockview-react";
import { AlertTriangle } from "lucide-react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { useT } from "@/i18n/use-t.ts";

export const PANEL_TRANSFER_UNAVAILABLE_COMPONENT_ID =
  "panel-transfer-unavailable";

export interface PanelTransferUnavailableParams {
  /**
   * Original dockview panel descriptor (component id, panel id, title,
   * params) captured at rewrite time. Capped at 256 KiB JSON by the contract.
   */
  originalDescriptor: {
    componentId: string;
    panelId: string;
    title: string;
    params?: Readonly<Record<string, unknown>>;
  };
  /**
   * Role this placeholder plays in the transfer: "source" if the source
   * panel's component disappeared before the source window could remove it,
   * "target" if the target window booted and the panel's component is not
   * registered here.
   */
  transferRole: "source" | "target";
}

function readUnavailableParams(
  params: unknown
): PanelTransferUnavailableParams | null {
  if (!(params && typeof params === "object" && "transferRole" in params)) {
    return null;
  }
  const obj = params as PanelTransferUnavailableParams;
  if (obj.transferRole !== "source" && obj.transferRole !== "target") {
    return null;
  }
  if (
    !(
      obj.originalDescriptor &&
      typeof obj.originalDescriptor === "object" &&
      typeof obj.originalDescriptor.componentId === "string" &&
      typeof obj.originalDescriptor.panelId === "string"
    )
  ) {
    return null;
  }
  return obj;
}

export function PanelTransferUnavailablePanel(
  props: IDockviewPanelProps
): React.ReactElement {
  const t = useT();
  const parsed = readUnavailableParams(props.params);
  const role = parsed?.transferRole ?? "target";
  const originalComponent = parsed?.originalDescriptor.componentId ?? "";
  const originalTitle =
    parsed?.originalDescriptor.title ?? props.api.title ?? "";
  usePanelDescriptor(props.api, {
    display: {
      long: originalTitle,
      short: originalTitle,
    },
  });
  const title =
    role === "source"
      ? t("workspace.panelTransfer.unavailableSourceTitle")
      : t("workspace.panelTransfer.unavailableTargetTitle");
  const body =
    role === "source"
      ? t("workspace.panelTransfer.unavailableSourceBody")
      : t("workspace.panelTransfer.unavailableTargetBody", {
          component: originalComponent,
        });
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto size-8 text-warning" />
        <h2 className="mt-3 font-semibold text-foreground text-lg">{title}</h2>
        <p className="mt-2 text-muted-foreground text-sm">{body}</p>
      </div>
    </div>
  );
}
