/**
 * Action 域 model. Action 只描述"能做什么", Keybinding 描述"怎么触发".
 * 二者一对多, 通过 commandId 字符串关联.
 */
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { LucideIcon } from "lucide-react";

export interface ActionInvocation {
  // 右键 surface 携带的目标载荷 —— 例如 files/tree-item 里被右键的树节点、
  // files/editor 里的当前选区。数据结构由具体 surface + action 双方约定。
  metadata?: Record<string, unknown>;
  sourcePanelComponent?: string;
  sourcePanelContext?: PanelContext;
  sourcePanelGroupId?: string;
  sourcePanelId?: string;
  surface?: string;
}

export interface ActionMetadata {
  aliases?: () => readonly string[];
  categoryKey?: ActionCategoryKey;
  /** true = 执行后不计入命令面板 MRU。仅给 clearRecent 这类元命令用 */
  excludeFromMru?: boolean;
  /**
   * 菜单/命令面板内分段 key. 不同 group 之间渲染时自动插 separator;
   * 同 group 内按 sortOrder 升序. 字典序排列, 数字前缀控制大段顺序:
   *   - "navigation"   永远第一 (VSCode 保留)
   *   - "1_*" ~ "8_*"  中间段
   *   - "9_close"      关闭类
   *   - "9_other"      未指定时默认
   *   - "z_*"          永远末尾
   * 缺省视作 "9_other".
   */
  group?: string;
  iconComponent?: LucideIcon;
  /**
   * 返回 true 时该 action 从右键菜单整行移除 (非置灰)。只在 buildMenuEntries
   * 投影 context menu 时生效;命令面板/快捷键路径不读此字段。
   */
  menuHidden?: (invocation?: ActionInvocation) => boolean;
  /**
   * 菜单 accelerator 展示可借用另一条 command 的 keybinding.
   * 用于菜单 action 与快捷键 action 分离, 但用户需要看到同一个快捷键提示的场景.
   */
  shortcutSourceId?: string;
  sortOrder?: number;
  /**
   * 设置后, 该 action 进同名子菜单. 同 surface 内 submenu() 返回相同字符串的
   * action 会聚合成一个 MenuItemSubmenu (label = 返回值, children = 按
   * group/sortOrder 排序). 子菜单本身在父菜单的位置 = 其内第一个 action 的位置.
   * 命令面板忽略此字段, 永远平铺展示.
   */
  submenu?: () => string;
  titleKey?: string;
}

export type ActionCategoryKey =
  | "file"
  | "git"
  | "panel"
  | "run"
  | "settings"
  | "terminal"
  | "view"
  | "window"
  | "workspace"
  | "worktree";

export interface Action {
  category: string;
  disabledReason?: () => string | null | undefined;
  enabled?: (invocation?: ActionInvocation) => boolean;
  handler: (invocation?: ActionInvocation) => void | Promise<void>;
  id: string;
  metadata?: ActionMetadata;
  /** 命令面板 / 右键菜单 surface 列表。空数组 = 仅快捷键触发，不在任何 surface 展示。 */
  surfaces?: readonly (string & {})[];
  /** 返回当前 locale 下的显示文本; 函数式以便随 i18n 实时更新。 */
  title: (invocation?: ActionInvocation) => string;
}
