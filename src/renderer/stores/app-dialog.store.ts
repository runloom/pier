/**
 * 宿主级模态弹窗(alert/confirm)状态容器。全局同一时刻只有一个弹窗:
 * 新请求会把上一个未决弹窗按「取消」resolve 掉再顶替。
 * 渲染与 blocking overlay 生命周期由 components/common/app-dialog-host.tsx 承担。
 */
import { create } from "zustand";

export interface AppAlertOptions {
  body?: string;
  confirmLabel?: string;
  title: string;
}

export interface AppConfirmOptions extends AppAlertOptions {
  cancelLabel?: string;
}

export interface AppDialogRequest {
  body?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  kind: "alert" | "confirm";
  resolve(confirmed: boolean): void;
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
  options: AppConfirmOptions
): Promise<boolean> {
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
      title: options.title,
      ...(options.body ? { body: options.body } : {}),
      ...(options.cancelLabel ? { cancelLabel: options.cancelLabel } : {}),
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
