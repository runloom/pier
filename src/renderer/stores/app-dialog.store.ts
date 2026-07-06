/**
 * 宿主级模态弹窗(alert/confirm)状态容器。全局同一时刻只有一个弹窗:
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
  size?: AppDialogSize;
  title: string;
}

export interface AppConfirmOptions extends AppAlertOptions {
  cancelLabel?: string;
  intent: AppDialogIntent;
  size: AppDialogSize;
}

export interface AppDialogRequest {
  body?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  intent: AppDialogIntent;
  kind: "alert" | "confirm";
  resolve(confirmed: boolean): void;
  size: AppDialogSize;
  title: string;
}

interface AppDialogState {
  current: AppDialogRequest | null;
}

export const useAppDialogStore = create<AppDialogState>(() => ({
  current: null,
}));

function openAppDialog(
  kind: AppDialogRequest["kind"],
  options: AppAlertOptions | AppConfirmOptions
): Promise<boolean> {
  // 模态弹窗与命令面板不叠放: 弹窗出现时先关面板 (close 幂等,
  // 未 accept 的 quick-pick 由面板 dismiss effect 兜底调 onDismiss)。
  useCommandPaletteController.getState().close();
  useAppDialogStore.getState().current?.resolve(false);
  return new Promise((resolvePromise) => {
    const request: AppDialogRequest = {
      kind,
      resolve: (confirmed) => {
        if (useAppDialogStore.getState().current === request) {
          useAppDialogStore.setState({ current: null });
        }
        resolvePromise(confirmed);
      },
      intent: options.intent ?? "default",
      size: options.size ?? "default",
      title: options.title,
      ...(options.body ? { body: options.body } : {}),
      ...("cancelLabel" in options && options.cancelLabel
        ? { cancelLabel: options.cancelLabel }
        : {}),
      ...(options.confirmLabel ? { confirmLabel: options.confirmLabel } : {}),
    };
    useAppDialogStore.setState({ current: request });
  });
}

export async function showAppAlert(options: AppAlertOptions): Promise<void> {
  await openAppDialog("alert", options);
}

export function showAppConfirm(options: AppConfirmOptions): Promise<boolean> {
  return openAppDialog("confirm", options);
}

export function resetAppDialogForTests(): void {
  useAppDialogStore.getState().current?.resolve(false);
  useAppDialogStore.setState({ current: null });
}
