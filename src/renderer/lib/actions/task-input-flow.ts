import type {
  TaskInputRequest,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";

export async function collectTaskInputs(
  inputs: readonly TaskInputRequest[]
): Promise<Record<string, string> | null> {
  const values: Record<string, string> = {};
  for (const input of inputs) {
    if (input.type === "promptString") {
      // biome-ignore lint/suspicious/noAlert: command palette does not yet expose a text-input quick pick.
      const value = window.prompt(
        input.description ?? input.id,
        input.default ?? ""
      );
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

export async function spawnTaskWithInputResolution(
  spawn: (inputs?: Record<string, string>) => Promise<TaskSpawnResult>
): Promise<TaskSpawnResult | null> {
  let result = await spawn();
  if (result.status !== "requires-input") {
    return result;
  }
  const inputs = await collectTaskInputs(result.inputs);
  if (!inputs) {
    return null;
  }
  result = await spawn(inputs);
  return result;
}
