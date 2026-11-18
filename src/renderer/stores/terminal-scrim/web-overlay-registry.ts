import type {
  TerminalBoxShadow,
  TerminalFrame,
  TerminalScrimBorder,
  TerminalScrimColor,
} from "@shared/contracts/terminal.ts";
import { sameScrimBorder } from "@/stores/terminal-scrim/appearance.ts";
import { sameScrim } from "@/stores/terminal-scrim/color.ts";
import { sameOverlayShadows } from "@/stores/terminal-scrim/shadow.ts";

export interface WebOverlayEntry {
  frame: TerminalFrame;
  /** false = 仅输入捕获，不参与 native 洞遮罩回填（见契约注释）。 */
  paints: boolean;
  /** 均匀圆角，content-view px。0 不写入。 */
  radius?: number;
  /** 半透明蒙层色。缺省表示不压暗终端。 */
  scrim?: TerminalScrimColor;
  /** 蒙层描边，native 在洞内补画。缺省表示无边框。 */
  scrimBorder?: TerminalScrimBorder;
  /** 外扩 box-shadow。缺省或空数组不写入。 */
  shadows?: TerminalBoxShadow[];
}

export interface WebOverlayRectInput {
  frame: TerminalFrame;
  paints?: boolean;
  radius?: number;
  scrim?: TerminalScrimColor;
  scrimBorder?: TerminalScrimBorder;
  shadows?: TerminalBoxShadow[];
}

const webOverlayRects = new Map<string, WebOverlayEntry>();
let onRegistryChange: (() => void) | null = null;

/** input-routing slice 在模块初始化时绑定状态广播。 */
export function bindWebOverlayRegistryChange(listener: () => void): void {
  onRegistryChange = listener;
}

export function getWebOverlayRects(): [string, WebOverlayEntry][] {
  return Array.from(webOverlayRects);
}

export function resetWebOverlayRectsForTests(): void {
  webOverlayRects.clear();
}

function frameKey(frame: TerminalFrame): string {
  return `${frame.x},${frame.y},${frame.width},${frame.height}`;
}

export function setWebOverlayRect(
  id: string,
  input: WebOverlayRectInput | null
): void {
  const previous = webOverlayRects.get(id);
  if (!input) {
    if (!previous) {
      return;
    }
    webOverlayRects.delete(id);
    onRegistryChange?.();
    return;
  }
  const paints = input.paints ?? true;
  const nextRadius =
    input.radius !== undefined && input.radius > 0 ? input.radius : undefined;
  const nextShadows = input.shadows?.length ? input.shadows : undefined;
  if (
    previous &&
    previous.paints === paints &&
    sameScrim(previous.scrim, input.scrim) &&
    sameScrimBorder(previous.scrimBorder, input.scrimBorder) &&
    sameOverlayShadows(previous.shadows, nextShadows) &&
    previous.radius === nextRadius &&
    frameKey(previous.frame) === frameKey(input.frame)
  ) {
    return;
  }
  webOverlayRects.set(id, {
    frame: input.frame,
    paints,
    ...(nextRadius === undefined ? {} : { radius: nextRadius }),
    ...(input.scrim === undefined ? {} : { scrim: input.scrim }),
    ...(input.scrimBorder === undefined
      ? {}
      : { scrimBorder: input.scrimBorder }),
    ...(nextShadows === undefined ? {} : { shadows: nextShadows }),
  });
  onRegistryChange?.();
}
