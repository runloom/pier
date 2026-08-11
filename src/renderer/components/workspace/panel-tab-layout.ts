/**
 * Dockview tab 几何与 kind 单一来源。
 * 标题槽限宽 / panel kind 标记只从这里读，禁止在 CSS/业务里再写魔法数。
 *
 * 限宽策略（金标准）：
 * - 默认：标题槽不限宽（内容定宽；条满靠横向滚动 + 溢出菜单）
 * - 例外：非路径 OSC 自由文案（agent/TUI）→ PANEL_TAB_OSC_TITLE_MAX_WIDTH_PX
 */

/**
 * 非路径 OSC 原文 tab short 的标题槽上限（px）。
 * 路径型 OSC 已收成 basename，不受此限；文件/用户钉名不限。
 */
export const PANEL_TAB_OSC_TITLE_MAX_WIDTH_PX = 240;

/** 拖拽 ghost 整 tab 上限（与 globals.css dragging 规则对齐）。 */
export const PANEL_TAB_GHOST_MAX_WIDTH_PX = 220;

export const PANEL_TAB_FILE_COMPONENT_ID = "pier.files.filePanel";
export const PANEL_TAB_REVIEW_COMPONENT_ID = "pier.git.changes";

export type PanelTabKind = "file" | "review";

/** dockview panel params used for file tab chrome (preview + dirty). */
export interface PanelTabFileParams {
  dirty?: unknown;
  pinned?: unknown;
}

export function panelTabKind(
  component: string | undefined
): PanelTabKind | undefined {
  if (component === PANEL_TAB_FILE_COMPONENT_ID) {
    return "file";
  }
  if (component === PANEL_TAB_REVIEW_COMPONENT_ID) {
    return "review";
  }
  return;
}

/**
 * Cursor / VS Code: only file panels with explicit `pinned: false` are preview
 * (italic). Other kits omit `pinned` and must stay normal tabs.
 */
export function panelTabParamsIsPreview(
  component: string | undefined,
  params: PanelTabFileParams | undefined
): boolean {
  return component === PANEL_TAB_FILE_COMPONENT_ID && params?.pinned === false;
}

/**
 * File unsaved mark (VS Code solid dirty dot). Written via updateParameters.
 */
export function panelTabParamsIsDirty(
  component: string | undefined,
  params: PanelTabFileParams | undefined
): boolean {
  return component === PANEL_TAB_FILE_COMPONENT_ID && params?.dirty === true;
}
