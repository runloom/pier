/**
 * 命令面板域 model: QuickPick / QuickPickItem。
 * Action / ActionMetadata 在 lib/actions/types.ts 中定义（共享）。
 */

import type { ReactNode } from "react";

export type CommandPaletteSurface = "command-palette" | (string & {});

export interface QuickPickItemBadge {
  readonly label: string;
  readonly variant?:
    | "default"
    | "destructive"
    | "ghost"
    | "outline"
    | "secondary";
}

export interface QuickPickItem {
  readonly aliases?: readonly string[];
  readonly badges?: readonly QuickPickItemBadge[];
  readonly checked?: boolean;
  readonly data?: unknown;
  readonly description?: string;
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: string;
  readonly searchTerms?: readonly string[];
}

export interface QuickPickSection {
  readonly heading: string;
  readonly id: string;
  readonly items: readonly QuickPickItem[];
}

export interface QuickPick {
  readonly items?: readonly QuickPickItem[];
  readonly loading?: boolean;
  onAccept(item: QuickPickItem): void | Promise<void>;
  /** 箭头键导航 / 鼠标 hover 时实时 preview。不传 → 无 preview。 */
  onChangeSelection?(item: QuickPickItem): void;
  /** Esc / 点击遮罩关闭时还原到打开前的值。不传 → 关闭即确认。 */
  onDismiss?(): void;
  readonly placeholder?: string;
  renderItem?(item: QuickPickItem): ReactNode;
  readonly sections?: readonly QuickPickSection[];
  readonly title: string;
}
