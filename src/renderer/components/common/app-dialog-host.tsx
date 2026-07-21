import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@pier/ui/alert-dialog.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Field, FieldError, FieldLabel } from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import { StatusIcon } from "@pier/ui/status-icon.tsx";
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppDialogRequest,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";

const APP_DIALOG_OVERLAY_ID = "app-dialog";

function DialogCopy({
  body,
  showDangerMark = false,
  title,
}: {
  body?: string | undefined;
  showDangerMark?: boolean;
  title: string;
}): ReactNode {
  return (
    <AlertDialogHeader>
      {showDangerMark ? (
        <div className="flex items-center gap-2.5">
          <StatusIcon className="shrink-0" kind="error" />
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </div>
      ) : (
        <AlertDialogTitle>{title}</AlertDialogTitle>
      )}
      {body ? (
        <AlertDialogDescription className="whitespace-pre-wrap">
          {body}
        </AlertDialogDescription>
      ) : null}
    </AlertDialogHeader>
  );
}

function isCurrentDialog(dialog: AppDialogRequest): boolean {
  return useAppDialogStore.getState().current === dialog;
}

export function AppDialogHost() {
  const currentDialog = useAppDialogStore((state) => state.current);
  const [retainedDialog, setRetainedDialog] = useState<AppDialogRequest | null>(
    currentDialog
  );

  useEffect(() => {
    if (!currentDialog) {
      return;
    }
    const releaseWebFocus = requestTerminalWebFocus(APP_DIALOG_OVERLAY_ID);
    const scopeId = `overlay:${APP_DIALOG_OVERLAY_ID}`;
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
      releaseWebFocus();
    };
  }, [currentDialog]);

  useLayoutEffect(() => {
    if (currentDialog) {
      setRetainedDialog(currentDialog);
    }
  }, [currentDialog]);

  const presentedDialog = currentDialog ?? retainedDialog;
  if (!presentedDialog) return null;

  return (
    <ActiveAppDialog
      dialog={presentedDialog}
      open={currentDialog === presentedDialog}
    />
  );
}

function ActiveAppDialog({
  dialog,
  open,
}: {
  dialog: AppDialogRequest;
  open: boolean;
}) {
  const t = useT();

  const isDestructive = dialog.intent === "destructive";
  const size = dialog.size;

  // Prompt 单独渲染:它需要局部 text-input state + validate,与 alert/confirm
  // 的一次性 resolve(true/false) 语义不同,分开写比在 union 上到处 narrow
  // 更清晰,也让 host 的顶层结构一目了然。
  if (dialog.kind === "prompt") {
    return (
      <PromptDialog
        dialog={dialog}
        isDestructive={isDestructive}
        open={open}
        size={size}
      />
    );
  }

  // 三选(保存/不保存/取消):macOS 桌面横排 —— alt | 取消 | confirm。
  // choice 一律 default 宽:三键 + 带文件名标题放不进 sm。
  if (dialog.kind === "choice") {
    return (
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen && isCurrentDialog(dialog)) {
            dialog.resolve("cancel");
          }
        }}
        open={open}
      >
        <AlertDialogContent
          size="default"
          terminalOverlayId={APP_DIALOG_OVERLAY_ID}
        >
          <DialogCopy body={dialog.body} title={dialog.title} />
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => dialog.resolve("alt")}
              variant={isDestructive ? "destructive" : "outline"}
            >
              {dialog.altLabel}
            </AlertDialogAction>
            <AlertDialogCancel
              onClick={() => dialog.resolve("cancel")}
              variant="outline"
            >
              {dialog.cancelLabel ?? t("dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
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
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isCurrentDialog(dialog)) {
          dialog.resolve(false);
        }
      }}
      open={open}
    >
      <AlertDialogContent size={size} terminalOverlayId={APP_DIALOG_OVERLAY_ID}>
        <DialogCopy
          body={dialog.body}
          showDangerMark={isDestructive && dialog.kind === "confirm"}
          title={dialog.title}
        />
        <AlertDialogFooter singleAction={dialog.kind === "alert"}>
          {dialog.kind === "confirm" ? (
            <AlertDialogCancel
              onClick={() => dialog.resolve(false)}
              variant="outline"
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
  open,
  size,
}: {
  dialog: PromptRequest;
  isDestructive: boolean;
  open: boolean;
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
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isCurrentDialog(dialog)) {
          dialog.resolve(null);
        }
      }}
      open={open}
    >
      <AlertDialogContent size={size} terminalOverlayId={APP_DIALOG_OVERLAY_ID}>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogCopy body={dialog.body} title={dialog.title} />
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
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={(event) => {
                event.preventDefault();
                dialog.resolve(null);
              }}
              variant="outline"
            >
              {dialog.cancelLabel ?? t("dialog.cancel")}
            </AlertDialogCancel>
            <Button
              disabled={pending}
              type="submit"
              variant={isDestructive ? "destructive" : "default"}
            >
              {dialog.confirmLabel ?? t("dialog.ok")}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
