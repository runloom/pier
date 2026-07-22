import type { ComponentType } from "react";

export type RendererPluginDialogIntent = "default" | "destructive";
export type RendererPluginDialogSize = "default" | "sm";
export type RendererPluginContentDialogSize = "sm" | "default" | "lg";

export interface RendererPluginContentDialogRenderProps<TResult = unknown> {
  close: (result?: TResult | null) => void;
  id: string;
  setDescription: (description?: string) => void;
  setDismissible: (dismissible: boolean) => void;
  setTitle: (title: string) => void;
}

export interface RendererPluginContentDialogOpenRequest<TResult = unknown> {
  closeOnOverlayClick?: boolean;
  content: ComponentType<RendererPluginContentDialogRenderProps<TResult>>;
  description?: string;
  dismissible?: boolean;
  id: string;
  size?: RendererPluginContentDialogSize;
  title: string;
}

export interface RendererPluginContentDialogHandle<TResult = unknown> {
  close(result?: TResult | null): void;
  id: string;
  result: Promise<TResult | null>;
  update(patch: {
    closeOnOverlayClick?: boolean;
    description?: string;
    dismissible?: boolean;
    title?: string;
  }): void;
}

/**
 * 宿主级模态弹窗。简单决策走 alert/confirm/choice/prompt（AppDialogHost）；
 * 多控件/多步/等待态走 open/update/close（AppContentDialogHost）。
 * 简单弹窗全局单槽，新请求会顶替未决旧弹窗；content dialog 为栈。
 * confirmLabel/cancelLabel 省略时用宿主 i18n 的默认文案(OK/Cancel)。
 */
export interface RendererPluginDialogsFacade {
  alert(options: {
    body?: string;
    confirmLabel?: string;
    intent?: RendererPluginDialogIntent;
    title: string;
  }): Promise<void>;
  /**
   * 三选弹窗(如 保存/放弃/取消)。confirm → "confirm",altLabel 按钮 →
   * "alt",取消/Esc → "cancel"。intent 作用于 alt 按钮(破坏性放弃)。
   */
  choice(options: {
    altLabel: string;
    body?: string;
    cancelLabel?: string;
    confirmLabel: string;
    intent: RendererPluginDialogIntent;
    size: RendererPluginDialogSize;
    title: string;
  }): Promise<"alt" | "cancel" | "confirm">;
  close(id: string, result?: unknown): void;
  confirm(options: {
    body?: string;
    cancelLabel?: string;
    confirmLabel?: string;
    intent: RendererPluginDialogIntent;
    size: RendererPluginDialogSize;
    title: string;
  }): Promise<boolean>;
  /** 打开宿主 content dialog。id 建议稳定；同 id 重开会替换并 resolve 旧 waiter 为 null。 */
  open<TResult = unknown>(
    request: RendererPluginContentDialogOpenRequest<TResult>
  ): RendererPluginContentDialogHandle<TResult>;
  // 文本输入弹窗。resolve:submit → 返回 trim 后的字符串;cancel → null。
  // validate 在 submit 前跑一次,返回非空 = 校验失败(在弹窗内展示,不 resolve),
  // 返回 null/undefined 才放行。keybinding scope + terminal focus 与 host 统一处理。
  prompt(options: {
    body?: string;
    cancelLabel?: string;
    confirmLabel?: string;
    initialValue?: string;
    intent: RendererPluginDialogIntent;
    placeholder?: string;
    size: RendererPluginDialogSize;
    title: string;
    validate?: (value: string) => Promise<string | null> | string | null;
  }): Promise<string | null>;
  update(
    id: string,
    patch: {
      closeOnOverlayClick?: boolean;
      description?: string;
      dismissible?: boolean;
      title?: string;
    }
  ): void;
}
