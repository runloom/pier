/**
 * 宿主级模态弹窗(alert/confirm/choice/prompt)状态容器。
 *
 * - 全局同一时刻只有一个简单弹窗：新请求会把上一个未决弹窗按「取消」resolve 掉再顶替。
 * - 渲染与 blocking overlay 生命周期由 components/common/app-dialog-host.tsx 承担。
 *
 * ## size 归属（禁止调用方传入）
 *
 * 宽度只由 kind 决定，API 不接受 `size`。禁止业务/插件再传自定义宽，避免回归到
 * “每个确认各自猜 sm/default”：
 *
 * | kind    | size    | 原因 |
 * |---------|---------|------|
 * | alert   | sm      | 单按钮告知 |
 * | confirm | sm      | 取消\|确认 短确认 |
 * | choice  | default | 三键横排略宽（token: max-w-sm；confirm 为 max-w-xs） |
 *
 * 更长内容请走 content dialog（`openAppContentDialog` / `dialogs.open`），不要
 * 用 default 宽的 confirm 硬塞说明。
 */
import { create } from "zustand";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";

export type AppDialogIntent = "default" | "destructive";

/** Host-internal only. Callers never choose this. */
export type AppDialogSize = "default" | "sm";

/** Size owned by dialog kind — single source of truth for AppDialogHost. */
export function appDialogSizeForKind(
  kind: "alert" | "confirm" | "choice" | "prompt"
): AppDialogSize {
  return kind === "choice" ? "default" : "sm";
}

export interface AppAlertOptions {
  body?: string | undefined;
  confirmLabel?: string | undefined;
  intent?: AppDialogIntent | undefined;
  title: string;
}

export interface AppConfirmOptions extends AppAlertOptions {
  cancelLabel?: string;
  intent: AppDialogIntent;
}

/**
 * 三选弹窗按钮横排顺序。
 * - `alt-cancel-confirm`（默认）：不保存 | 取消 | 保存
 * - `confirm-alt-cancel`：主动作 | 次动作 | 取消（如放弃更改：只放弃修改 | 全部放弃 | 取消）
 */
export type AppChoiceButtonOrder = "alt-cancel-confirm" | "confirm-alt-cancel";

/**
 * 三选弹窗(保存/放弃/取消形态)。confirm 是主按钮(默认动作,如保存),
 * alt 是次动作(intent 为 destructive 时按危险样式渲染,如放弃),
 * cancel/Esc 一律 resolve "cancel"。
 * size 固定 default，调用方不得传 size。
 */
export interface AppChoiceOptions extends AppAlertOptions {
  altLabel: string;
  /**
   * 按钮顺序。默认 `alt-cancel-confirm`；多破坏选项场景可用
   * `confirm-alt-cancel` 让主按钮靠左、取消靠右（对齐 VS Code discard）。
   */
  buttonOrder?: AppChoiceButtonOrder;
  cancelLabel?: string;
  confirmLabel: string;
  intent: AppDialogIntent;
}

export type AppChoiceResult = "alt" | "cancel" | "confirm";

// prompt = confirm + 单行文本输入。validate 在 submit 前跑一次,返回非空字符串
// 表示校验失败,直接展示错误、不 resolve;返回 null / undefined 才放行。
// size 固定 sm，调用方不得传 size。
export interface AppPromptOptions extends AppAlertOptions {
  cancelLabel?: string;
  initialValue?: string;
  intent: AppDialogIntent;
  placeholder?: string;
  validate?: (value: string) => Promise<string | null> | string | null;
}

interface BaseDialogRequest {
  body?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  intent: AppDialogIntent;
  size: AppDialogSize;
  title: string;
}

interface AlertConfirmDialogRequest extends BaseDialogRequest {
  kind: "alert" | "confirm";
  resolve(confirmed: boolean): void;
}

interface ChoiceDialogRequest extends BaseDialogRequest {
  altLabel: string;
  buttonOrder: AppChoiceButtonOrder;
  kind: "choice";
  resolve(result: AppChoiceResult): void;
}

interface PromptDialogRequest extends BaseDialogRequest {
  initialValue: string;
  kind: "prompt";
  placeholder?: string;
  resolve(value: string | null): void;
  validate?: (value: string) => Promise<string | null> | string | null;
}

export type AppDialogRequest =
  | AlertConfirmDialogRequest
  | ChoiceDialogRequest
  | PromptDialogRequest;

interface AppDialogState {
  current: AppDialogRequest | null;
}

export const useAppDialogStore = create<AppDialogState>(() => ({
  current: null,
}));

function dismissActive(): void {
  // 顶替旧弹窗时按语义"取消"归还:confirm/alert -> false, prompt -> null,
  // choice -> "cancel"。
  const active = useAppDialogStore.getState().current;
  if (!active) {
    return;
  }
  if (active.kind === "prompt") {
    active.resolve(null);
  } else if (active.kind === "choice") {
    active.resolve("cancel");
  } else {
    active.resolve(false);
  }
}

function openAlertConfirm(
  kind: "alert" | "confirm",
  options: AppAlertOptions | AppConfirmOptions
): Promise<boolean> {
  useCommandPaletteController.getState().close();
  dismissActive();
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const request: AlertConfirmDialogRequest = {
    intent: options.intent ?? "default",
    kind,
    resolve: (confirmed) => {
      if (useAppDialogStore.getState().current === request) {
        useAppDialogStore.setState({ current: null });
      }
      resolve(confirmed);
    },
    size: appDialogSizeForKind(kind),
    title: options.title,
    ...(options.body ? { body: options.body } : {}),
    ...("cancelLabel" in options && options.cancelLabel
      ? { cancelLabel: options.cancelLabel }
      : {}),
    ...(options.confirmLabel ? { confirmLabel: options.confirmLabel } : {}),
  };
  useAppDialogStore.setState({ current: request });
  return promise;
}

export async function showAppAlert(options: AppAlertOptions): Promise<void> {
  await openAlertConfirm("alert", options);
}

export function showAppConfirm(options: AppConfirmOptions): Promise<boolean> {
  return openAlertConfirm("confirm", options);
}

export function showAppChoice(
  options: AppChoiceOptions
): Promise<AppChoiceResult> {
  useCommandPaletteController.getState().close();
  dismissActive();
  return new Promise((resolvePromise) => {
    const request: ChoiceDialogRequest = {
      altLabel: options.altLabel,
      buttonOrder: options.buttonOrder ?? "alt-cancel-confirm",
      confirmLabel: options.confirmLabel,
      intent: options.intent,
      kind: "choice",
      resolve: (result) => {
        if (useAppDialogStore.getState().current === request) {
          useAppDialogStore.setState({ current: null });
        }
        resolvePromise(result);
      },
      size: appDialogSizeForKind("choice"),
      title: options.title,
      ...(options.body ? { body: options.body } : {}),
      ...(options.cancelLabel ? { cancelLabel: options.cancelLabel } : {}),
    };
    useAppDialogStore.setState({ current: request });
  });
}

export function showAppPrompt(
  options: AppPromptOptions
): Promise<string | null> {
  useCommandPaletteController.getState().close();
  dismissActive();
  return new Promise((resolvePromise) => {
    const request: PromptDialogRequest = {
      initialValue: options.initialValue ?? "",
      intent: options.intent,
      kind: "prompt",
      resolve: (value) => {
        if (useAppDialogStore.getState().current === request) {
          useAppDialogStore.setState({ current: null });
        }
        resolvePromise(value);
      },
      size: appDialogSizeForKind("prompt"),
      title: options.title,
      ...(options.body ? { body: options.body } : {}),
      ...(options.cancelLabel ? { cancelLabel: options.cancelLabel } : {}),
      ...(options.confirmLabel ? { confirmLabel: options.confirmLabel } : {}),
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
      ...(options.validate ? { validate: options.validate } : {}),
    };
    useAppDialogStore.setState({ current: request });
  });
}

export function resetAppDialogForTests(): void {
  dismissActive();
  useAppDialogStore.setState({ current: null });
}
