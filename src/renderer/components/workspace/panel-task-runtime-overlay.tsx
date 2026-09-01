import {
  type PanelFloatingLayout,
  panelFloatingLayoutFromParams,
} from "@shared/contracts/panel-floating.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { type RefObject, useMemo, useRef } from "react";
import { useTerminalFloatingLayoutRevision } from "@/panel-kits/terminal/hooks/use-floating-layout-revision.ts";
import {
  panelShouldMountRuntimeControl,
  useTerminalRuntimeControlPresentation,
} from "@/panel-kits/terminal/hooks/use-runtime-control-presentation.ts";
import { TerminalPanelFloatingHost } from "@/panel-kits/terminal/panel-floating-host.tsx";
import { TerminalRuntimeControl } from "@/panel-kits/terminal/runtime-control.tsx";
import { useTaskRunControlDismissStore } from "@/stores/task-run-control-dismiss.store.ts";
import {
  taskRunsForPanel,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";

/**
 * Web 面板（git / files 等）上的任务运行条。终端 kit 自带同一套浮层；
 * 这里只给非终端 origin 补齐「有蓝点必有条」，避免 Run Task 再去新开终端 tab。
 */
export function PanelTaskRuntimeOverlay({
  api,
  panelRootRef,
  params,
}: {
  api: IDockviewPanelProps["api"];
  panelRootRef: RefObject<HTMLDivElement | null>;
  params: unknown;
}) {
  const snapshot = useTaskRunsStore((state) => state.snapshot);
  const dismissed = useTaskRunControlDismissStore((state) => state.dismissed);
  const shouldMount = useMemo(() => {
    const dismissedRunIds = new Set(Object.keys(dismissed));
    return panelShouldMountRuntimeControl(
      taskRunsForPanel(snapshot, api.id),
      dismissedRunIds
    );
  }, [api.id, dismissed, snapshot]);

  if (!shouldMount) {
    return null;
  }

  return (
    <MountedPanelTaskRuntimeOverlay
      api={api}
      panelRootRef={panelRootRef}
      params={params}
    />
  );
}

function MountedPanelTaskRuntimeOverlay({
  api,
  panelRootRef,
  params,
}: {
  api: IDockviewPanelProps["api"];
  panelRootRef: RefObject<HTMLDivElement | null>;
  params: unknown;
}) {
  const runtimeControl = useTerminalRuntimeControlPresentation(api.id);
  const layoutRevision = useTerminalFloatingLayoutRevision(api);
  const layoutRef = useRef<PanelFloatingLayout>(
    panelFloatingLayoutFromParams(params)
  );
  layoutRef.current = panelFloatingLayoutFromParams(params);

  if (!runtimeControl.mounted) {
    return null;
  }

  return (
    <TerminalPanelFloatingHost
      layout={layoutRef.current}
      layoutRevision={layoutRevision}
      onPositionCommit={(itemId, position) => {
        const current = layoutRef.current;
        const next: PanelFloatingLayout = {
          positions: { ...current.positions, [itemId]: position },
          version: 1,
        };
        layoutRef.current = next;
        const record =
          params && typeof params === "object"
            ? (params as Record<string, unknown>)
            : {};
        api.updateParameters({ ...record, floatingLayout: next });
      }}
      panelId={api.id}
      panelRootRef={panelRootRef}
      primary={{
        content: (
          <TerminalRuntimeControl
            dismissRun={runtimeControl.dismissRun}
            now={runtimeControl.now}
            panelId={api.id}
            runs={runtimeControl.runs}
          />
        ),
        id: "runtime-controls",
        phase: runtimeControl.phase,
      }}
    />
  );
}
