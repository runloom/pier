/**
 * Keybinding 注册中心: 两层 (default / user) + 解绑标记 + scope tag.
 *
 *   - registerDefaults: 启动时灌入默认表. 重复调用幂等.
 *   - loadUserKeymap: 用户层整体替换. 含 "-commandId" 条目 → 屏蔽 default 同名 command.
 *   - resolve(chord, scopeState): 按 scope 优先级 [overlay 阻断] > [panel] > [global].
 *     overlay 阻断意味着栈顶 overlay scope miss 不 fall through.
 *     panel scope miss 才 fall through global.
 *   - getBindingsFor(commandId): 反向查询.
 */
import { Notifier } from "@/lib/util/notifier.ts";
import { chordEquals, isMac } from "./matcher.ts";
import { parseChord, parseCommandId } from "./parse.ts";
import type {
  Keybinding,
  KeybindingInput,
  KeybindingScope,
  KeyChord,
  KeymapSource,
  ResolveScopeState,
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

  resolve(chord: KeyChord, scopeState: ResolveScopeState): string | null {
    const topOverlay = scopeState.overlayStack.at(-1);
    if (topOverlay) {
      // 阻断: 不 fall through 到 panel/global.
      return this.findInScope(chord, `overlay:${topOverlay}`);
    }
    if (scopeState.activePanelComponent) {
      const panelScope: KeybindingScope = `panel:${scopeState.activePanelComponent}`;
      const hit = this.findInScope(chord, panelScope);
      if (hit) {
        return hit;
      }
    }
    return this.findInScope(chord, "global");
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

  /**
   * 在指定 scope 内查匹配 chord 的 commandId.
   * user 层优先, default 层兜底; user 解绑的 default 条目跳过.
   * Pier keymap < 20 条, flat O(n) 遍历足够 — 不上索引.
   */
  private findInScope(chord: KeyChord, scope: KeybindingScope): string | null {
    for (const [commandId, list] of this.userOverrides) {
      for (const binding of list) {
        if (binding.scope === scope && chordEquals(binding.chord, chord)) {
          return commandId;
        }
      }
    }
    for (const [commandId, list] of this.defaults) {
      if (this.userUnbinds.has(commandId)) {
        continue;
      }
      for (const binding of list) {
        if (binding.scope === scope && chordEquals(binding.chord, chord)) {
          return commandId;
        }
      }
    }
    return null;
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
    const chord = parseChord(input.keys, isMac());
    const scope: KeybindingScope = input.scope ?? "global";
    const table = source === "user" ? this.userOverrides : this.defaults;
    const list = table.get(parsed.commandId) ?? [];
    if (list.some((b) => b.scope === scope && chordEquals(b.chord, chord))) {
      return;
    }
    list.push({ chord, commandId: parsed.commandId, scope, source });
    table.set(parsed.commandId, list);
  }
}

export const keybindingRegistry = new KeybindingRegistry();
