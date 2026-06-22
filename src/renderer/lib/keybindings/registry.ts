/**
 * Keybinding 注册中心: 两层 (default / user) + 解绑标记.
 *
 *   - registerDefaults: 启动时灌入默认表. 重复调用幂等.
 *   - loadUserKeymap: 用户层整体替换. 含 "-commandId" 条目 → 屏蔽 default 同名 command.
 *   - resolve(chord): 用户层优先, 默认层兜底; user 解绑的 default 条目跳过.
 *   - getBindingsFor(commandId): 反向查询.
 */
import { Notifier } from "@/lib/util/notifier.ts";
import { chordEquals } from "./matcher.ts";
import { parseChord, parseCommandId } from "./parse.ts";
import type {
  Keybinding,
  KeybindingInput,
  KeyChord,
  KeymapSource,
} from "./types.ts";

class KeybindingRegistry extends Notifier {
  private readonly defaults = new Map<string, Keybinding[]>();
  private readonly userOverrides = new Map<string, Keybinding[]>();
  private readonly userUnbinds = new Set<string>();

  registerDefaults(inputs: readonly KeybindingInput[]): void {
    for (const input of inputs) {
      this.addOneSafe(input, "default");
    }
    this.notify();
  }

  loadUserKeymap(inputs: readonly KeybindingInput[]): void {
    this.userOverrides.clear();
    this.userUnbinds.clear();
    for (const input of inputs) {
      this.addOneSafe(input, "user");
    }
    this.notify();
  }

  resolve(chord: KeyChord): string | null {
    for (const [commandId, list] of this.userOverrides) {
      for (const binding of list) {
        if (chordEquals(binding.chord, chord)) {
          return commandId;
        }
      }
    }
    for (const [commandId, list] of this.defaults) {
      if (this.userUnbinds.has(commandId)) {
        continue;
      }
      for (const binding of list) {
        if (chordEquals(binding.chord, chord)) {
          return commandId;
        }
      }
    }
    return null;
  }

  getBindingsFor(commandId: string): readonly Keybinding[] {
    const user = this.userOverrides.get(commandId);
    if (user && user.length > 0) {
      return user;
    }
    if (this.userUnbinds.has(commandId)) {
      return [];
    }
    return this.defaults.get(commandId) ?? [];
  }

  private addOneSafe(input: KeybindingInput, source: KeymapSource): void {
    try {
      this.addOne(input, source);
    } catch (err) {
      console.error(
        `[keybindings] failed to register ${input.commandId} (${source}):`,
        err
      );
    }
  }

  private addOne(input: KeybindingInput, source: KeymapSource): void {
    const parsed = parseCommandId(input.commandId);
    if (parsed.unbind) {
      if (source === "user") {
        this.userUnbinds.add(parsed.commandId);
      }
      return;
    }
    const chord = parseChord(input.keys);
    const table = source === "user" ? this.userOverrides : this.defaults;
    const list = table.get(parsed.commandId) ?? [];
    if (list.some((b) => chordEquals(b.chord, chord))) {
      return;
    }
    list.push({ commandId: parsed.commandId, chord, source });
    table.set(parsed.commandId, list);
  }
}

export const keybindingRegistry = new KeybindingRegistry();
