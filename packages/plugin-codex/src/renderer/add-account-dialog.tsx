import type {
  ExternalRendererPluginContext,
  RendererPluginContentDialogRenderProps,
} from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { ExternalLink, ShieldCheck, UserPlus } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import type { CodexLoginState } from "../shared/accounts.ts";
import type { Translate } from "./usage-meter.tsx";

function isLoginCancellation(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && error.message === "Login cancelled")
  );
}

const ADD_DIALOG_ID = "accounts.add";

function AddAccountContent({
  context,
  login,
  onError,
  t,
  close,
  setDismissible,
  setTitle,
  setDescription,
  initialLogin,
}: RendererPluginContentDialogRenderProps & {
  context: ExternalRendererPluginContext;
  login: CodexLoginState | null;
  onError: (error: unknown) => void;
  t: Translate;
  initialLogin: CodexLoginState | null;
}): JSX.Element {
  const [presentation, setPresentation] = useState<"authorize" | "waiting">(
    initialLogin ? "waiting" : "authorize"
  );
  const [starting, setStarting] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "cancel" | "restart" | null
  >(null);
  const operationId = useRef(0);
  const previousLogin = useRef<CodexLoginState | null>(initialLogin);
  const waiting = login !== null || starting;

  useEffect(() => {
    if (login) {
      setPresentation("waiting");
      setDismissible(false);
      setTitle(
        t(
          "pier.codex.accounts.settings.addDialogWaitingTitle",
          "Waiting for browser authorization"
        )
      );
      setDescription(
        t(
          "pier.codex.accounts.settings.addDialogWaitingDescription",
          "Complete Codex login in your browser. This dialog closes automatically after authorization."
        )
      );
    } else if (previousLogin.current) {
      setPresentation("authorize");
      setStarting(false);
      setDismissible(true);
      close(null);
    }
    previousLogin.current = login;
  }, [close, login, setDescription, setDismissible, setTitle, t]);

  const startLogin = (): void => {
    const currentOperation = ++operationId.current;
    setPresentation("waiting");
    setStarting(true);
    setDismissible(false);
    setTitle(
      t(
        "pier.codex.accounts.settings.addDialogWaitingTitle",
        "Waiting for browser authorization"
      )
    );
    setDescription(
      t(
        "pier.codex.accounts.settings.addDialogWaitingDescription",
        "Complete Codex login in your browser. This dialog closes automatically after authorization."
      )
    );
    context.rpc
      .invoke("accounts.add", {})
      .then(() => {
        if (operationId.current === currentOperation) close(null);
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
        setPresentation("authorize");
        setDismissible(true);
        close(null);
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

  if (presentation === "waiting") {
    return (
      <div className="flex flex-col gap-4" data-pier-codex-scope="">
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
        <div className="flex flex-wrap justify-end gap-2">
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-pier-codex-scope="">
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
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          disabled={waiting}
          onClick={() => close(null)}
          type="button"
          variant="outline"
        >
          {t("pier.codex.accounts.settings.cancel", "Cancel")}
        </Button>
        <Button disabled={starting} onClick={startLogin} type="button">
          {t(
            "pier.codex.accounts.settings.addDialogContinue",
            "Continue in browser"
          )}
          <ExternalLink data-icon="inline-end" />
        </Button>
      </div>
    </div>
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
  const openHandleId = useRef<string | null>(null);

  const openAddDialog = useCallback((): void => {
    const handle = context.dialogs.open({
      id: ADD_DIALOG_ID,
      title: t(
        "pier.codex.accounts.settings.addDialogTitle",
        "Add Codex account"
      ),
      description: t(
        "pier.codex.accounts.settings.addDialogDescription",
        "Pier will open Codex login in your browser. The account appears here automatically after authorization."
      ),
      size: "default",
      dismissible: login === null,
      content: (props) => (
        <AddAccountContent
          {...props}
          context={context}
          initialLogin={login}
          login={login}
          onError={onError}
          t={t}
        />
      ),
    });
    openHandleId.current = handle.id;
    handle.result
      .catch(() => undefined)
      .finally(() => {
        if (openHandleId.current === handle.id) {
          openHandleId.current = null;
        }
      });
  }, [context, login, onError, t]);

  useEffect(() => {
    if (!login) {
      if (openHandleId.current) {
        context.dialogs.close(openHandleId.current, null);
        openHandleId.current = null;
      }
      return;
    }
    if (openHandleId.current) {
      context.dialogs.update(ADD_DIALOG_ID, {
        dismissible: false,
        title: t(
          "pier.codex.accounts.settings.addDialogWaitingTitle",
          "Waiting for browser authorization"
        ),
        description: t(
          "pier.codex.accounts.settings.addDialogWaitingDescription",
          "Complete Codex login in your browser. This dialog closes automatically after authorization."
        ),
      });
      return;
    }
    openAddDialog();
  }, [context, login, openAddDialog, t]);

  return (
    <Button onClick={openAddDialog} type="button">
      <UserPlus data-icon="inline-start" />
      {t("pier.codex.accounts.settings.addAccount", "Add account")}
    </Button>
  );
}
