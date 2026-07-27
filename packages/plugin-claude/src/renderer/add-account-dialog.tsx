import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import { UserPlus } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef } from "react";
import type { ClaudeLoginState } from "../shared/accounts.ts";
import { AddAccountContent } from "./add-account-content.tsx";
import type { Translate } from "./format-account-error.ts";
import { useClaudeAccountsSnapshot } from "./use-accounts-snapshot.ts";

const ADD_DIALOG_ID = "accounts.add";

export function AddAccountDialog({
  context,
  onError,
  t,
}: {
  context: ExternalRendererPluginContext;
  onError: (error: unknown) => void;
  t: Translate;
}): JSX.Element {
  const openHandleId = useRef<string | null>(null);
  const { snapshot } = useClaudeAccountsSnapshot(context);
  const login = snapshot?.login ?? null;
  const previousLoginRef = useRef<ClaudeLoginState | null>(login);

  const openAddDialog = useCallback((): void => {
    const handle = context.dialogs.open({
      id: ADD_DIALOG_ID,
      title: t(
        "pier.claude.accounts.settings.addDialogTitle",
        "Add Claude account"
      ),
      description: t(
        "pier.claude.accounts.settings.addDialogDescription",
        "Sign in with the browser, or import the account already signed in with the Claude CLI."
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
          "pier.claude.accounts.settings.addDialogWaitingTitle",
          "Waiting for authorization"
        ),
        description: t(
          "pier.claude.accounts.settings.addDialogWaitingDescription",
          "Authorize in the browser, then paste the code from the callback page."
        ),
      });
      return;
    }
    openAddDialog();
  }, [context, login, openAddDialog, t]);

  return (
    <Button onClick={openAddDialog} type="button">
      <UserPlus data-icon="inline-start" />
      {t("pier.claude.accounts.settings.addAccount", "Add account")}
    </Button>
  );
}
