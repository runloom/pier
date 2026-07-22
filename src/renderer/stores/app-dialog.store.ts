/**
 * 宿主级模态弹窗(alert/confirm/prompt)状态容器。全局同一时刻只有一个弹窗:
 * 新请求会把上一个未决弹窗按「取消」resolve 掉再顶替。
 * 渲染与 blocking overlay 生命周期由 components/common/app-dialog-host.tsx 承担。
 */
import { create } from "zustand";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";

export type AppDialogIntent = "default" | "destructive";
export type AppDialogSize = "default" | "sm";

export interface AppAlertOptions {
  body?: string;
  confirmLabel?: string;
  intent?: AppDialogIntent;
  title: string;
}

export interface AppConfirmOptions extends AppAlertOptions {
  cancelLabel?: string;
  intent: AppDialogIntent;
  size: AppDialogSize;
}

/**
 * 三选弹窗(保存/放弃/取消形态)。confirm 是主按钮(默认动作,如保存),
 * alt 是次动作(intent 为 destructive 时按危险样式渲染,如放弃),
 * cancel/Esc 一律 resolve "cancel"。
 */
export interface AppChoiceOptions extends AppAlertOptions {
  altLabel: string;
  cancelLabel?: string;
  confirmLabel: string;
  intent: AppDialogIntent;
  size: AppDialogSize;
}

export type AppChoiceResult = "alt" | "cancel" | "confirm";

// prompt = confirm + 单行文本输入。validate 在 submit 前跑一次,返回非空字符串
// 表示校验失败,直接展示错误、不 resolve;返回 null / undefined 才放行。
export interface AppPromptOptions extends AppAlertOptions {
  cancelLabel?: string;
  initialValue?: string;
  intent: AppDialogIntent;
  placeholder?: string;
  size: AppDialogSize;
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
  const size: AppDialogSize =
    kind === "confirm" ? (options as AppConfirmOptions).size : "sm";
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
    // alert is always sm; confirm keeps caller-chosen size.
    size,
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
      confirmLabel: options.confirmLabel,
      intent: options.intent,
      kind: "choice",
      resolve: (result) => {
        if (useAppDialogStore.getState().current === request) {
          useAppDialogStore.setState({ current: null });
        }
        resolvePromise(result);
      },
      size: options.size,
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
      size: options.size,
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
