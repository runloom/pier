import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@pier/ui/alert-dialog.tsx";
import { Field, FieldError, FieldLabel } from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import { LogOutIcon } from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppDialogRequest,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";

const APP_DIALOG_OVERLAY_ID = "app-dialog";

export function AppDialogHost() {
  const t = useT();
  const dialog = useAppDialogStore((state) => state.current);

  useEffect(() => {
    if (!dialog) {
      return;
    }
    const route = registerTerminalFullscreenWebOverlay(APP_DIALOG_OVERLAY_ID);
    const releaseWebFocus = requestTerminalWebFocus(APP_DIALOG_OVERLAY_ID);
    const scopeId = `overlay:${APP_DIALOG_OVERLAY_ID}`;
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
      releaseWebFocus();
      route.dispose();
    };
  }, [dialog]);

  if (!dialog) {
    return null;
  }

  const isDestructive = dialog.intent === "destructive";
  const size = dialog.size;

  // Prompt 单独渲染:它需要局部 text-input state + validate,与 alert/confirm
  // 的一次性 resolve(true/false) 语义不同,分开写比在 union 上到处 narrow
  // 更清晰,也让 host 的顶层结构一目了然。
  if (dialog.kind === "prompt") {
    return (
      <PromptDialog dialog={dialog} isDestructive={isDestructive} size={size} />
    );
  }

  // 三选(保存/不保存/取消):macOS sheet 语义 —— 主按钮(保存)整行置顶,
  // 次按钮(不保存)与取消同宽次行,全部纵向排布。sm 弹窗的 2 列 grid footer
  // 放不下三键(第三键换行左对齐,视觉破碎),显式覆盖为单列。
  if (dialog.kind === "choice") {
    return (
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            dialog.resolve("cancel");
          }
        }}
        open
      >
        <AlertDialogContent size={size}>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            {dialog.body ? (
              <AlertDialogDescription className="whitespace-pre-wrap">
                {dialog.body}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse! grid-cols-1! sm:flex-col-reverse!">
            <AlertDialogCancel
              className="w-full"
              onClick={() => dialog.resolve("cancel")}
              variant="ghost"
            >
              {dialog.cancelLabel ?? t("dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="w-full"
              onClick={() => dialog.resolve("alt")}
              variant={isDestructive ? "destructive" : "outline"}
            >
              {dialog.altLabel}
            </AlertDialogAction>
            <AlertDialogAction
              className="w-full"
              onClick={() => dialog.resolve("confirm")}
              variant="default"
            >
              {dialog.confirmLabel ?? t("dialog.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          dialog.resolve(false);
        }
      }}
      open
    >
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          {isDestructive ? (
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <LogOutIcon aria-hidden="true" />
            </AlertDialogMedia>
          ) : null}
          <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
          {dialog.body ? (
            <AlertDialogDescription className="whitespace-pre-wrap">
              {dialog.body}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {dialog.kind === "confirm" ? (
            <AlertDialogCancel
              onClick={() => dialog.resolve(false)}
              variant={isDestructive ? "ghost" : "outline"}
            >
              {dialog.cancelLabel ?? t("dialog.cancel")}
            </AlertDialogCancel>
          ) : null}
          <AlertDialogAction
            onClick={() => dialog.resolve(true)}
            variant={isDestructive ? "destructive" : "default"}
          >
            {dialog.confirmLabel ?? t("dialog.ok")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type PromptRequest = Extract<AppDialogRequest, { kind: "prompt" }>;

function PromptDialog({
  dialog,
  isDestructive,
  size,
}: {
  dialog: PromptRequest;
  isDestructive: boolean;
  size: "default" | "sm";
}) {
  const t = useT();
  const [value, setValue] = useState(dialog.initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 每次 dialog request 变更(新弹窗顶替旧的)重置局部状态。
  useEffect(() => {
    setValue(dialog.initialValue);
    setError(null);
    setPending(false);
  }, [dialog]);

  const handleSubmit = useCallback(
    async (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = value.trim();
      setPending(true);
      try {
        const validation = dialog.validate
          ? await Promise.resolve(dialog.validate(trimmed))
          : null;
        if (validation) {
          setError(validation);
          setPending(false);
          return;
        }
      } catch (validationError) {
        setError(
          validationError instanceof Error
            ? validationError.message
            : t("dialog.error.invalid")
        );
        setPending(false);
        return;
      }
      dialog.resolve(trimmed);
    },
    [dialog, t, value]
  );

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          dialog.resolve(null);
        }
      }}
      open
    >
      <AlertDialogContent size={size}>
        <form onSubmit={handleSubmit}>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            {dialog.body ? (
              <AlertDialogDescription className="whitespace-pre-wrap">
                {dialog.body}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <div className="px-6 pt-2 pb-4">
            <Field data-invalid={Boolean(error)}>
              <FieldLabel className="sr-only" htmlFor="app-dialog-prompt">
                {dialog.title}
              </FieldLabel>
              <Input
                aria-invalid={Boolean(error)}
                autoFocus
                id="app-dialog-prompt"
                onChange={(event) => {
                  setValue(event.target.value);
                  if (error) {
                    setError(null);
                  }
                }}
                placeholder={dialog.placeholder}
                value={value}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={(event) => {
                event.preventDefault();
                dialog.resolve(null);
              }}
              variant={isDestructive ? "ghost" : "outline"}
            >
              {dialog.cancelLabel ?? t("dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              type="submit"
              variant={isDestructive ? "destructive" : "default"}
            >
              {dialog.confirmLabel ?? t("dialog.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
