import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import { UserPlus } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef } from "react";
import type { GrokLoginState } from "../shared/accounts.ts";
import { AddAccountContent } from "./add-account-content.tsx";
import type { Translate } from "./format-account-error.ts";

const ADD_DIALOG_ID = "accounts.add";

export function AddAccountDialog({
  context,
  login,
  onError,
  t,
}: {
  context: ExternalRendererPluginContext;
  login: GrokLoginState | null;
  onError: (error: unknown) => void;
  t: Translate;
}): JSX.Element {
  const openHandleId = useRef<string | null>(null);
  const previousLoginRef = useRef<GrokLoginState | null>(login);

  const openAddDialog = useCallback((): void => {
    const handle = context.dialogs.open({
      id: ADD_DIALOG_ID,
      title: t(
        "pier.grok.accounts.settings.addDialogTitle",
        "Add Grok account"
      ),
      description: t(
        "pier.grok.accounts.settings.addDialogDescription",
        "Choose how to add a Grok account. Device-code login uses the Grok CLI; API keys and local import use credentials already on this device."
      ),
      size: "default",
      dismissible: login === null,
      content: (props) => (
        <AddAccountContent
          {...props}
          context={context}
          initialLogin={login}
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
    const previousLogin = previousLoginRef.current;
    previousLoginRef.current = login;
    if (!login) {
      if (previousLogin && openHandleId.current) {
        context.dialogs.close(openHandleId.current, null);
        openHandleId.current = null;
      }
      return;
    }
    if (openHandleId.current) {
      context.dialogs.update(ADD_DIALOG_ID, {
        dismissible: false,
        title: t(
          "pier.grok.accounts.settings.addDialogWaitingTitle",
          "Waiting for authorization"
        ),
        description: t(
          "pier.grok.accounts.settings.addDialogWaitingDescription",
          "Complete Grok login. This dialog closes automatically after authorization."
        ),
      });
      return;
    }
    openAddDialog();
  }, [context, login, openAddDialog, t]);

  return (
    <Button onClick={openAddDialog} type="button">
      <UserPlus data-icon="inline-start" />
      {t("pier.grok.accounts.settings.addAccount", "Add account")}
    </Button>
  );
}
