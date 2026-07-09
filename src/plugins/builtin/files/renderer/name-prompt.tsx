import type { RendererPluginContext } from "@plugins/api/renderer.ts";

// Files 插件里所有 create / rename 都走宿主 `context.dialogs.prompt`,不再
// 维护本地 modal 组件。宿主 (AppDialogHost) 统一处理 shadcn AlertDialog +
// blocking overlay + terminal focus + keybinding scope,插件只关心业务参数。

export interface FilesNamePromptOptions {
  cancelLabel?: string;
  confirmLabel?: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  title: string;
  validate?: (value: string) => Promise<string | null> | string | null;
}

interface FilesNamePromptResult {
  readonly cancelled: true;
  readonly value?: never;
}

interface FilesNamePromptSubmit {
  readonly cancelled: false;
  readonly value: string;
}

export type FilesNamePromptOutcome =
  | FilesNamePromptResult
  | FilesNamePromptSubmit;

export async function showFilesNamePrompt(
  context: RendererPluginContext,
  options: FilesNamePromptOptions
): Promise<FilesNamePromptOutcome> {
  const value = await context.dialogs.prompt({
    intent: "default",
    size: "sm",
    title: options.title,
    ...(options.cancelLabel ? { cancelLabel: options.cancelLabel } : {}),
    ...(options.confirmLabel ? { confirmLabel: options.confirmLabel } : {}),
    ...(options.description ? { body: options.description } : {}),
    ...(options.initialValue === undefined
      ? {}
      : { initialValue: options.initialValue }),
    ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    ...(options.validate ? { validate: options.validate } : {}),
  });
  if (value === null) {
    return { cancelled: true };
  }
  return { cancelled: false, value };
}
