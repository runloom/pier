import i18next from "i18next";
import { RotateCcw, Square } from "lucide-react";
import { useTaskRunControlDismissStore } from "@/stores/task-run-control-dismiss.store.ts";
import type { ActionContribution } from "./contribution-types.ts";
import {
  forceStopAvailable,
  resolveTaskRunActionTarget,
  restartTaskRun,
  stopTaskRun,
} from "./task-run-operations.ts";
import type { ActionInvocation } from "./types.ts";

function activeStopTarget(invocation?: ActionInvocation) {
  const target = resolveTaskRunActionTarget(invocation);
  if (
    !(
      target?.run &&
      ["pending", "running", "stopping"].includes(target.run.status)
    )
  ) {
    return null;
  }
  return target;
}

function canStopCurrentTarget(invocation?: ActionInvocation): boolean {
  const target = activeStopTarget(invocation);
  if (!target) {
    return false;
  }
  return (
    target.run?.status !== "stopping" ||
    forceStopAvailable(target.run, Date.now())
  );
}

export const TASK_RUN_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "run",
    enabled: canStopCurrentTarget,
    handler: async (invocation) => {
      const target = resolveTaskRunActionTarget(invocation);
      if (
        !(
          target?.run &&
          ["pending", "running", "stopping"].includes(target.run.status)
        )
      ) {
        return;
      }
      const force = forceStopAvailable(target.run, Date.now());
      if (target.run.status === "stopping" && !force) {
        return;
      }
      const outcome = await stopTaskRun(target.run, force);
      if (outcome === "dismiss") {
        useTaskRunControlDismissStore.getState().dismiss(target.run.runId);
      }
    },
    id: "pier.run.stopTask",
    group: "1_run",
    iconComponent: Square,
    menuHidden: (invocation) => activeStopTarget(invocation) === null,
    sortOrder: 2,
    surfaces: ["dockview-tab", "terminal/content", "terminal/restored"],
    titleKey: "terminal.runtimeControl.stop",
    title: (invocation) => {
      const target = activeStopTarget(invocation);
      return i18next.t(
        target?.run && forceStopAvailable(target.run, Date.now())
          ? "terminal.runtimeControl.forceStop"
          : "terminal.runtimeControl.stop"
      );
    },
  },
  {
    categoryKey: "run",
    enabled: (invocation) => resolveTaskRunActionTarget(invocation) !== null,
    handler: async (invocation) => {
      const target = resolveTaskRunActionTarget(invocation);
      if (target) {
        await restartTaskRun(target);
      }
    },
    id: "pier.run.rerunTask",
    group: "1_run",
    iconComponent: RotateCcw,
    menuHidden: (invocation) => resolveTaskRunActionTarget(invocation) === null,
    sortOrder: 1,
    surfaces: [
      "dockview-tab",
      "terminal/content",
      "terminal/restored",
      "command-palette",
    ],
    titleKey: "contextMenu.action.rerunTask",
    title: () => i18next.t("contextMenu.action.rerunTask"),
  },
];
