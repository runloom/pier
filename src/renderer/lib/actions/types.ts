/**
 * Action 域 model. Action 只描述"能做什么", Keybinding 描述"怎么触发".
 * 二者一对多, 通过 commandId 字符串关联.
 */
import type { LucideIcon } from "lucide-react";

export interface ActionMetadata {
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
  keywords?: readonly string[];
  sortOrder?: number;
}

export interface Action {
  category: string;
  enabled?: () => boolean;
  handler: () => void | Promise<void>;
  id: string;
  metadata?: ActionMetadata;
  /** 命令面板 / 右键菜单 surface 列表。空数组 = 仅快捷键触发，不在任何 surface 展示。 */
  surfaces?: readonly (string & {})[];
  /** 返回当前 locale 下的显示文本; 函数式以便随 i18n 实时更新。 */
  title: () => string;
}
