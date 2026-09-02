/**
 * 菜单 / 命令面板上的快捷键提示。
 * 优先反查已注册绑定，其次 shortcutSourceId，最后才用 displayChord（只显示、不进 keymap）。
 */
import { isMac } from "@/lib/keybindings/matcher.ts";
import { parseChord } from "@/lib/keybindings/parse.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import type { KeyChord } from "@/lib/keybindings/types.ts";
import type {
  Action,
  ActionInvocation,
  ActionShortcutSourceId,
} from "./types.ts";

export function resolveActionShortcutSourceId(
  shortcutSourceId: ActionShortcutSourceId | undefined,
  invocation?: ActionInvocation
): string | undefined {
  if (typeof shortcutSourceId === "function") {
    return shortcutSourceId(invocation);
  }
  return shortcutSourceId;
}

export function resolveActionShortcutChord(
  action: Pick<Action, "id" | "metadata">,
  invocation?: ActionInvocation
): KeyChord | undefined {
  const sourceId = resolveActionShortcutSourceId(
    action.metadata?.shortcutSourceId,
    invocation
  );
  const binding = keybindingRegistry.getFirstBindingFor(action.id, sourceId);
  if (binding) {
    return binding.chord;
  }
  const displayChord = action.metadata?.displayChord;
  if (!displayChord) {
    return;
  }
  try {
    return parseChord(displayChord, isMac());
  } catch {
    return;
  }
}
