import type {
  ExternalRendererPluginContext,
  RendererPluginContentDialogRenderProps,
} from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import {
  HardDrive,
  MonitorSmartphone,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  type JSX,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { GrokLoginState } from "../shared/accounts.ts";
import { AddAccountWaiting } from "./add-account-waiting.tsx";
import type { Translate } from "./format-account-error.ts";
import { useGrokAccountsSnapshot } from "./use-accounts-snapshot.ts";

function isLoginCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "Login cancelled")
  );
}

type AddTab = "account" | "api_key" | "local";
const ADD_DIALOG_ID = "accounts.add";
type AddAccountContentProps = RendererPluginContentDialogRenderProps & {
  context: ExternalRendererPluginContext;
  initialLogin: GrokLoginState | null;
  onError: (error: unknown) => void;
  t: Translate;
};
function AddAccountContent({
  context,
  onError,
  t,
  close,
  setDismissible,
  setTitle,
  setDescription,
  initialLogin,
}: AddAccountContentProps): JSX.Element {
  // Read login state live from the snapshot store: the dialog host freezes
  // content props at open time, so a `login` prop would go permanently stale
  // and leave the waiting screen showing outdated device-code state. Until
  // the first snapshot arrives, fall back to the open-time value so the
  // missing data is not mistaken for "login ended".
  const { snapshot } = useGrokAccountsSnapshot(context);
  const login = snapshot ? (snapshot.login ?? null) : initialLogin;
  const [tab, setTab] = useState<AddTab>("account");
  const [presentation, setPresentation] = useState<"choose" | "waiting">(
    initialLogin ? "waiting" : "choose"
  );
  const [starting, setStarting] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "cancel" | "restart" | null
  >(null);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyLabel, setApiKeyLabel] = useState("");
  const operationId = useRef(0);
  const previousLogin = useRef<GrokLoginState | null>(initialLogin);
  const apiKeyInputId = useId();
  const apiKeyLabelInputId = useId();
  const waiting = login !== null || starting;
  useEffect(() => {
    if (login) {
      setPresentation("waiting");
      setDismissible(false);
      setTitle(
        t(
          "pier.grok.accounts.settings.addDialogWaitingTitle",
          "Waiting for authorization"
        )
      );
      setDescription(
        t(
          "pier.grok.accounts.settings.addDialogWaitingDescription",
          "Complete Grok login. This dialog closes automatically after authorization."
        )
      );
    } else if (previousLogin.current) {
      setPresentation("choose");
      setStarting(false);
      setDismissible(true);
      close(null);
    }
    previousLogin.current = login;
  }, [close, login, setDescription, setDismissible, setTitle, t]);

  const startDeviceLogin = (): void => {
    const currentOperation = ++operationId.current;
    setPresentation("waiting");
    setStarting(true);
    setDismissible(false);
    setTitle(
      t(
        "pier.grok.accounts.settings.addDialogWaitingTitle",
        "Waiting for authorization"
      )
    );
    setDescription(
      t(
        "pier.grok.accounts.settings.addDialogWaitingDescription",
        "Complete Grok login. This dialog closes automatically after authorization."
      )
    );
    context.rpc
      .invoke("accounts.add", { kind: "oidc", mode: "device" })
      .then(() => {
        if (operationId.current === currentOperation) {
          close(null);
        }
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
        if (operationId.current === currentOperation) {
          setStarting(false);
        }
      });
  };
  const submitApiKey = (): void => {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      return;
    }
    const currentOperation = ++operationId.current;
    setStarting(true);
    context.rpc
      .invoke("accounts.add", {
        apiKey: trimmed,
        kind: "api_key",
        ...(apiKeyLabel.trim() ? { label: apiKeyLabel.trim() } : {}),
      })
      .then(() => {
        if (operationId.current === currentOperation) {
          close(null);
        }
      })
      .catch((error: unknown) => {
        if (operationId.current === currentOperation) {
          onError(error);
        }
      })
      .finally(() => {
        if (operationId.current === currentOperation) {
          setStarting(false);
        }
      });
  };

  const adoptLocal = (): void => {
    const currentOperation = ++operationId.current;
    setStarting(true);
    context.rpc
      .invoke("accounts.adoptCurrent", null)
      .then(() => {
        if (operationId.current === currentOperation) {
          close(null);
        }
      })
      .catch((error: unknown) => {
        if (operationId.current === currentOperation) {
          onError(error);
        }
      })
      .finally(() => {
        if (operationId.current === currentOperation) {
          setStarting(false);
        }
      });
  };
  const cancelLogin = (): void => {
    setPendingAction("cancel");
    context.rpc
      .invoke("accounts.cancelLogin", null)
      .then(() => {
        operationId.current += 1;
        setStarting(false);
        setPresentation("choose");
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
        startDeviceLogin();
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
      <AddAccountWaiting
        deviceCode={login?.deviceCode}
        deviceVerificationUrl={login?.deviceVerificationUrl}
        loginActive={login !== null || starting}
        onCancel={cancelLogin}
        onOpenVerificationUrl={(url) => {
          context.app.openExternal(url).catch(onError);
        }}
        onRestart={restartLogin}
        pendingAction={pendingAction}
        t={t}
      />
    );
  }

  let actionButtons: JSX.Element;
  if (tab === "api_key") {
    actionButtons = (
      <Button
        aria-busy={starting || undefined}
        disabled={starting || apiKey.trim().length === 0}
        onClick={submitApiKey}
        type="button"
      >
        {starting ? <Spinner data-icon="inline-start" /> : null}
        {t("pier.grok.accounts.settings.addDialogApiKeySubmit", "Add API key")}
      </Button>
    );
  } else if (tab === "local") {
    actionButtons = (
      <Button
        aria-busy={starting || undefined}
        disabled={starting}
        onClick={adoptLocal}
        type="button"
      >
        {starting ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <HardDrive data-icon="inline-start" />
        )}
        {t(
          "pier.grok.accounts.settings.addDialogLocalSubmit",
          "Import local account"
        )}
      </Button>
    );
  } else {
    actionButtons = (
      <Button disabled={starting} onClick={startDeviceLogin} type="button">
        {starting ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <MonitorSmartphone data-icon="inline-start" />
        )}
        {t("pier.grok.accounts.settings.addDialogDevice", "Use device code")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-pier-grok-scope="">
      <Item size="sm" variant="muted">
        <ItemMedia variant="icon">
          <ShieldCheck aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemDescription>
            {t(
              "pier.grok.accounts.settings.addDialogLocalCredential",
              "Credentials are stored only on this device"
            )}
          </ItemDescription>
        </ItemContent>
      </Item>

      <Tabs
        onValueChange={(value) => {
          if (value === "account" || value === "api_key" || value === "local") {
            setTab(value);
          }
        }}
        value={tab}
      >
        <TabsList className="w-full">
          <TabsTrigger className="flex-1" value="account">
            {t(
              "pier.grok.accounts.settings.addDialogTabAccount",
              "Account login"
            )}
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="api_key">
            {t("pier.grok.accounts.settings.addDialogTabApiKey", "API key")}
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="local">
            {t("pier.grok.accounts.settings.addDialogTabLocal", "Local import")}
          </TabsTrigger>
        </TabsList>

        <TabsContent className="mt-3" value="account">
          <p className="text-muted-foreground text-sm">
            {t(
              "pier.grok.accounts.settings.addDialogAccountDescription",
              "Sign in with a device code from the Grok CLI. The verification link and code appear here; the account is added automatically after authorization."
            )}
          </p>
        </TabsContent>

        <TabsContent className="mt-3" value="api_key">
          <FieldSet>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={apiKeyInputId}>
                  {t("pier.grok.accounts.settings.addDialogApiKey", "API key")}
                </FieldLabel>
                <Input
                  autoComplete="off"
                  id={apiKeyInputId}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={t(
                    "pier.grok.accounts.settings.addDialogApiKeyPlaceholder",
                    "xai-..."
                  )}
                  spellCheck={false}
                  type="password"
                  value={apiKey}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={apiKeyLabelInputId}>
                  {t(
                    "pier.grok.accounts.settings.addDialogApiKeyLabel",
                    "Label (optional)"
                  )}
                </FieldLabel>
                <Input
                  id={apiKeyLabelInputId}
                  onChange={(event) => setApiKeyLabel(event.target.value)}
                  value={apiKeyLabel}
                />
              </Field>
            </FieldGroup>
          </FieldSet>
          <p className="mt-2 text-muted-foreground text-xs">
            {t(
              "pier.grok.accounts.settings.addDialogApiKeyDescription",
              "Store an xAI API key for this account. Active API-key accounts clear the Grok session token so the key can take effect in sessions that supply XAI_API_KEY."
            )}
          </p>
        </TabsContent>

        <TabsContent className="mt-3" value="local">
          <p className="text-muted-foreground text-sm">
            {t(
              "pier.grok.accounts.settings.addDialogLocalDescription",
              "Import the account already signed in on this device (~/.grok/auth.json). It becomes the active Pier account."
            )}
          </p>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          disabled={waiting}
          onClick={() => close(null)}
          type="button"
          variant="outline"
        >
          {t("pier.grok.accounts.settings.cancel", "Cancel")}
        </Button>
        {actionButtons}
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
      // Close only when a login actually *ended* (non-null → null). The
      // effect also re-runs on unrelated re-renders (e.g. a usage refresh
      // updating the snapshot) — those must not close a dialog the user
      // just opened manually.
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
