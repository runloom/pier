import type {
  TaskInputRequest,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";

export interface TaskSpawnCallOptions {
  inputs?: Record<string, string>;
  skipMissingDependencies?: boolean;
}

export async function collectTaskInputs(
  inputs: readonly TaskInputRequest[]
): Promise<Record<string, string> | null> {
  const values: Record<string, string> = {};
  for (const input of inputs) {
    if (input.type === "promptString") {
      const value = await new Promise<string | null>((resolve) => {
        useCommandPaletteController.getState().openQuickPick({
          initialQuery: input.default ?? "",
          items: [],
          onAccept: () => undefined,
          onAcceptQuery: resolve,
          onDismiss: () => resolve(null),
          placeholder: input.description ?? input.id,
          title: input.description ?? input.id,
        });
      });
      if (value === null) {
        return null;
      }
      values[input.id] = value;
      continue;
    }
    const selected = await new Promise<string | null>((resolve) => {
      useCommandPaletteController.getState().openQuickPick({
        title: input.description ?? input.id,
        placeholder: input.description ?? input.id,
        items: input.options.map((option) => ({
          checked: option === input.default,
          id: option,
          label: option,
        })),
        onAccept: (item) => {
          resolve(item.id);
        },
        onDismiss: () => {
          resolve(null);
        },
      });
    });
    if (selected === null) {
      return null;
    }
    values[input.id] = selected;
  }
  return values;
}

function missingDependenciesConfirmBody(
  taskLabel: string,
  missingDependencies: readonly string[]
): string {
  const sep = i18next.t("commandPalette.run.missingDependenciesListSep");
  return i18next.t("commandPalette.run.missingDependenciesBody", {
    deps: missingDependencies.join(sep),
    task: taskLabel,
  });
}

/**
 * 收集 input 变量；依赖缺失时确认后可 skip（跳过缺失项，可解析依赖仍会跑）。
 * 返回 null 表示用户取消。
 */
export async function spawnTaskWithInputResolution(
  spawn: (options?: TaskSpawnCallOptions) => Promise<TaskSpawnResult>
): Promise<TaskSpawnResult | null> {
  let collectedInputs: Record<string, string> | undefined;

  const spawnOnce = async (
    options?: TaskSpawnCallOptions
  ): Promise<TaskSpawnResult | null> => {
    const base: TaskSpawnCallOptions = {
      ...options,
      ...(collectedInputs ? { inputs: collectedInputs } : {}),
    };
    const result = await spawn(Object.keys(base).length > 0 ? base : undefined);
    if (result.status !== "requires-input") {
      return result;
    }
    const inputs = await collectTaskInputs(result.inputs);
    if (!inputs) {
      return null;
    }
    collectedInputs = { ...collectedInputs, ...inputs };
    return await spawn({
      ...options,
      inputs: collectedInputs,
    });
  };

  const result = await spawnOnce();
  if (!result) {
    return null;
  }
  if (result.status !== "missing-dependencies") {
    return result;
  }
  const confirmed = await showAppConfirm({
    body: missingDependenciesConfirmBody(
      result.taskLabel,
      result.missingDependencies
    ),
    confirmLabel: i18next.t("commandPalette.run.runWithoutDependencies"),
    intent: "default",
    title: i18next.t("commandPalette.run.missingDependenciesTitle"),
  });
  if (!confirmed) {
    return null;
  }
  return await spawnOnce({ skipMissingDependencies: true });
}
