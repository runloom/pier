import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@pier/ui/dialog.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { ExternalLink, ShieldCheck, UserPlus } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import type { CodexLoginState } from "../shared/accounts.ts";
import type { Translate } from "./usage-meter.tsx";

function isLoginCancellation(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && error.message === "Login cancelled")
  );
}

export function AddAccountDialog({
  context,
  login,
  onError,
  t,
}: {
  context: ExternalRendererPluginContext;
  login: CodexLoginState | null;
  onError: (error: unknown) => void;
  t: Translate;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [presentation, setPresentation] = useState<"authorize" | "waiting">(
    "authorize"
  );
  const [starting, setStarting] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "cancel" | "restart" | null
  >(null);
  const operationId = useRef(0);
  const previousLogin = useRef<CodexLoginState | null>(null);
  const waiting = login !== null || starting;

  useEffect(() => {
    if (login) {
      setPresentation("waiting");
      setOpen(true);
    } else if (previousLogin.current) {
      setOpen(false);
    }
    previousLogin.current = login;
  }, [login]);

  const startLogin = (): void => {
    const currentOperation = ++operationId.current;
    setPresentation("waiting");
    setStarting(true);
    context.rpc
      .invoke("accounts.add", {})
      .then(() => {
        if (operationId.current === currentOperation) setOpen(false);
      })
      .catch((error: unknown) => {
        if (
          operationId.current === currentOperation &&
          !isLoginCancellation(error)
        ) {
          onError(error);
        }
      })
      .finally(() => {
        if (operationId.current === currentOperation) setStarting(false);
      });
  };

  const cancelLogin = (): void => {
    setPendingAction("cancel");
    context.rpc
      .invoke("accounts.cancelLogin", null)
      .then(() => {
        operationId.current += 1;
        setStarting(false);
        setOpen(false);
      })
      .catch((error: unknown) => {
        onError(error);
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const restartLogin = (): void => {
    setPendingAction("restart");
    context.rpc
      .invoke("accounts.cancelLogin", null)
      .then(() => {
        setPendingAction(null);
        startLogin();
      })
      .catch((error: unknown) => {
        onError(error);
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          if (!waiting) {
            setPresentation("authorize");
            setOpen(true);
          }
          return;
        }
        if (!waiting) {
          setOpen(false);
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <UserPlus data-icon="inline-start" />
          {t("pier.codex.accounts.settings.addAccount", "Add account")}
        </Button>
      </DialogTrigger>
      <DialogContent
        initialFocus="firstFocusable"
        onEscapeKeyDown={(event) => {
          if (waiting) event.preventDefault();
        }}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {presentation === "waiting"
              ? t(
                  "pier.codex.accounts.settings.addDialogWaitingTitle",
                  "Waiting for browser authorization"
                )
              : t(
                  "pier.codex.accounts.settings.addDialogTitle",
                  "Add Codex account"
                )}
          </DialogTitle>
          <DialogDescription>
            {presentation === "waiting"
              ? t(
                  "pier.codex.accounts.settings.addDialogWaitingDescription",
                  "Complete Codex login in your browser. This dialog closes automatically after authorization."
                )
              : t(
                  "pier.codex.accounts.settings.addDialogDescription",
                  "Pier will open Codex login in your browser. The account appears here automatically after authorization."
                )}
          </DialogDescription>
        </DialogHeader>
        {presentation === "waiting" ? (
          <Item size="sm" variant="muted">
            <ItemMedia variant="icon">
              <Spinner />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>
                {t(
                  "pier.codex.accounts.settings.addDialogWaitingStatus",
                  "Waiting for Codex authorization…"
                )}
              </ItemDescription>
            </ItemContent>
          </Item>
        ) : (
          <Item size="sm" variant="muted">
            <ItemMedia variant="icon">
              <ShieldCheck aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>
                {t(
                  "pier.codex.accounts.settings.addDialogLocalCredential",
                  "Credentials are stored only on this device"
                )}
              </ItemDescription>
            </ItemContent>
          </Item>
        )}
        <DialogFooter>
          {presentation === "waiting" ? (
            <>
              <Button
                aria-busy={pendingAction === "cancel" || undefined}
                disabled={pendingAction !== null || login === null}
                onClick={cancelLogin}
                type="button"
                variant="outline"
              >
                {pendingAction === "cancel" ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {t("pier.codex.accounts.settings.cancelLogin", "Cancel login")}
              </Button>
              <Button
                aria-busy={pendingAction === "restart" || undefined}
                disabled={pendingAction !== null || login === null}
                onClick={restartLogin}
                type="button"
                variant="secondary"
              >
                {pendingAction === "restart" ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {t(
                  "pier.codex.accounts.settings.addDialogReopenBrowser",
                  "Reopen browser"
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => setOpen(false)}
                type="button"
                variant="outline"
              >
                {t("pier.codex.accounts.settings.cancel", "Cancel")}
              </Button>
              <Button onClick={startLogin} type="button">
                {t(
                  "pier.codex.accounts.settings.addDialogContinue",
                  "Continue in browser"
                )}
                <ExternalLink data-icon="inline-end" />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
