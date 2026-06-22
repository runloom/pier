/**
 * Action 域 model. Action 只描述"能做什么", Keybinding 描述"怎么触发".
 * 二者一对多, 通过 commandId 字符串关联.
 */

export interface ActionMetadata {
  keywords?: readonly string[];
  sortOrder?: number;
}

export interface Action {
  category: string;
  enabled?: () => boolean;
  handler: () => void | Promise<void>;
  id: string;
  metadata?: ActionMetadata;
  /** 返回当前 locale 下的显示文本; 函数式以便随 i18n 实时更新。 */
  title: () => string;
}
