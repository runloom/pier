/**
 * 右键 surface 能力表 — 控制 edit/layout 共享菜单并入策略。
 *
 * - panel/edit：共享「复制选区 / 全选」
 * - panel/layout：共享「聚焦 / 均分」
 * - panel/content：兜底壳 surface，展开为 content + edit + layout
 *
 * 未知 surface 默认不 merge（防对象菜单被 layout 污染）；新 popup 调用点必须登记。
 */

export type SurfaceRole =
  | "chrome"
  | "document"
  | "object"
  | "shared"
  | "viewport";

export type SelectionSource =
  | "dom"
  | "editor-engine"
  | "native-terminal"
  | "none"
  | "provider";

export interface SurfaceProfile {
  /** 是否并入 panel/edit（内容复制 / 全选）。 */
  readonly mergeEdit: boolean;
  /** 是否并入 panel/layout（聚焦 / 均分）。 */
  readonly mergeLayout: boolean;
  readonly role: SurfaceRole;
  readonly selectionSource: SelectionSource;
  /**
   * 是否自带编辑管线（native 终端 / CM 编辑器），
   * 为 true 时隐藏共享 pier.panel.copySelection / selectAll。
   */
  readonly specializedEditPipeline: boolean;
}

/** 共享编辑项 surface id。 */
export const PANEL_EDIT_SURFACE = "panel/edit";

/** 共享布局项 surface id。 */
export const PANEL_LAYOUT_SURFACE = "panel/layout";

/**
 * 内容区兜底 surface（PanelContentContextShell 仍 popup 此 id）。
 * expand 结果 = panel/content + panel/edit + panel/layout。
 */
export const PANEL_CONTENT_SURFACE = "panel/content";

const SHARED_SURFACE_PROFILE = {
  mergeEdit: false,
  mergeLayout: false,
  role: "shared",
  selectionSource: "none",
  specializedEditPipeline: false,
} as const satisfies SurfaceProfile;

/**
 * 已登记 surface 能力表。新增 contextMenu.popup / popupContextMenuAt 的 surface
 * 必须写入此表（治理测试扫描调用点）。
 */
export const SURFACE_PROFILES: Readonly<Record<string, SurfaceProfile>> = {
  [PANEL_CONTENT_SURFACE]: {
    mergeEdit: true,
    mergeLayout: true,
    role: "viewport",
    selectionSource: "dom",
    specializedEditPipeline: false,
  },
  [PANEL_EDIT_SURFACE]: SHARED_SURFACE_PROFILE,
  [PANEL_LAYOUT_SURFACE]: SHARED_SURFACE_PROFILE,
  "command-palette": {
    mergeEdit: false,
    mergeLayout: false,
    role: "chrome",
    selectionSource: "none",
    specializedEditPipeline: false,
  },
  "create-menu": {
    mergeEdit: false,
    mergeLayout: false,
    role: "chrome",
    selectionSource: "none",
    specializedEditPipeline: false,
  },
  "dockview-tab": {
    mergeEdit: false,
    mergeLayout: false,
    role: "chrome",
    selectionSource: "none",
    specializedEditPipeline: false,
  },
  "files/breadcrumb": {
    mergeEdit: false,
    mergeLayout: false,
    role: "object",
    selectionSource: "none",
    specializedEditPipeline: false,
  },
  "files/canvas-preview": {
    mergeEdit: true,
    mergeLayout: false,
    role: "document",
    selectionSource: "dom",
    specializedEditPipeline: false,
  },
  "files/editor": {
    mergeEdit: false,
    mergeLayout: false,
    role: "document",
    selectionSource: "editor-engine",
    specializedEditPipeline: true,
  },
  "files/markdown-preview": {
    mergeEdit: true,
    mergeLayout: false,
    role: "document",
    selectionSource: "dom",
    specializedEditPipeline: false,
  },
  "files/search-result": {
    mergeEdit: false,
    mergeLayout: false,
    role: "object",
    selectionSource: "none",
    specializedEditPipeline: false,
  },
  "files/tree-background": {
    mergeEdit: false,
    mergeLayout: false,
    role: "object",
    selectionSource: "none",
    specializedEditPipeline: false,
  },
  "files/tree-item": {
    mergeEdit: false,
    mergeLayout: false,
    role: "object",
    selectionSource: "none",
    specializedEditPipeline: false,
  },
  /**
   * Git Changes diff body: Jump to Source + shared copy/selectAll (provider)
   * + panel layout. Specialized line selection lives on PierDiffView.
   */
  "git/review-diff": {
    mergeEdit: true,
    mergeLayout: true,
    role: "document",
    selectionSource: "provider",
    specializedEditPipeline: false,
  },
  "git/review-tree-item": {
    mergeEdit: false,
    mergeLayout: false,
    role: "object",
    selectionSource: "none",
    specializedEditPipeline: false,
  },
  "terminal/content": {
    mergeEdit: false,
    mergeLayout: true,
    role: "viewport",
    selectionSource: "native-terminal",
    specializedEditPipeline: true,
  },
  // 任务恢复 DOM 结果（RestoredTaskResultView）：共享 edit + layout（均分/焦点组等），
  // 无 native 终端 ops（specializedEditPipeline=false）。
  "terminal/restored": {
    mergeEdit: true,
    mergeLayout: true,
    role: "document",
    selectionSource: "dom",
    specializedEditPipeline: false,
  },
};

export function getSurfaceProfile(surface: string): SurfaceProfile | undefined {
  return SURFACE_PROFILES[surface];
}

/**
 * 右键是否需要先 `panel.api.setActive()`。
 *
 * 故意按 role 全量判定（不只 Git）：所有 document/viewport 内容右键都不应
 * 为 layout/edit 共享项抢 active。终端 live 在 popup 前自行 setActive；
 * files/editor 动作靠 metadata 自洽，不依赖 active 面板。
 *
 * - document / viewport：用户已在内容上右键；强制 setActive 会冲掉行选区，
 *   并对 `unmountWhenHidden` 面板（如 Git Changes）触发重挂载 → 滚动回顶。
 * - dockview-tab：关 inactive tab 时不能先激活它（adjacent 策略会切错 active）。
 * - object / chrome / 未登记 surface：仍激活 source，便于树行等依赖 active 的动作。
 */
export function shouldActivatePanelForContextMenu(surface: string): boolean {
  if (surface === "dockview-tab") {
    return false;
  }
  const profile = SURFACE_PROFILES[surface];
  if (!profile) {
    return true;
  }
  return profile.role !== "document" && profile.role !== "viewport";
}

/**
 * 自带复制/全选管线的 surface：共享 panel/edit 项应 menuHidden。
 * 仅 terminal live 与 files editor；树是 object，靠 mergeEdit=false 不出现共享项。
 */
export function hasSpecializedEditPipeline(
  surface: string | undefined
): boolean {
  if (!surface) {
    return false;
  }
  return SURFACE_PROFILES[surface]?.specializedEditPipeline === true;
}

/**
 * 展开 popup surface 到 action 查询列表。
 * 未知 surface：仅自身（不 merge），防止 layout 泄漏。
 */
export function expandContextMenuSurfaces(surface: string): readonly string[] {
  const profile = SURFACE_PROFILES[surface];
  if (!profile) {
    return [surface];
  }
  const out: string[] = [surface];
  if (profile.mergeEdit) {
    out.push(PANEL_EDIT_SURFACE);
  }
  if (profile.mergeLayout) {
    out.push(PANEL_LAYOUT_SURFACE);
  }
  return out;
}

/** 治理：全部已登记 surface id。 */
export function listedContextMenuSurfaces(): readonly string[] {
  return Object.keys(SURFACE_PROFILES).sort();
}
