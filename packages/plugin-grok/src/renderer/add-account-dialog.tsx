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
  ExternalLink,
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
import type { Translate } from "./format-account-error.ts";

function isLoginCancellation(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && error.message === "Login cancelled")
  );
}

type AddTab = "account" | "api_key";
type OidcMode = "oauth" | "device";

const ADD_DIALOG_ID = "accounts.add";

interface AddAccountContentProps
  extends RendererPluginContentDialogRenderProps {
  context: ExternalRendererPluginContext;
  initialLogin: GrokLoginState | null;
  login: GrokLoginState | null;
  onError: (error: unknown) => void;
  t: Translate;
}

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
}: AddAccountContentProps): JSX.Element {
  const [tab, setTab] = useState<AddTab>("account");
  const [oidcMode, setOidcMode] = useState<OidcMode>("oauth");
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

  const startOidc = (nextMode: OidcMode): void => {
    const currentOperation = ++operationId.current;
    setOidcMode(nextMode);
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
      .invoke("accounts.add", { kind: "oidc", mode: nextMode })
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
        startOidc(oidcMode);
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
      <div className="flex flex-col gap-4" data-pier-grok-scope="">
        <Item size="sm" variant="muted">
          <ItemMedia variant="icon">
            <Spinner />
          </ItemMedia>
          <ItemContent>
            <ItemDescription>
              {t(
                "pier.grok.accounts.settings.addDialogWaitingStatus",
                "Waiting for Grok authorization…"
              )}
            </ItemDescription>
          </ItemContent>
        </Item>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            aria-busy={pendingAction === "cancel" || undefined}
            disabled={pendingAction !== null}
            onClick={cancelLogin}
            type="button"
            variant="outline"
          >
            {pendingAction === "cancel" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            {t("pier.grok.accounts.settings.cancelLogin", "Cancel login")}
          </Button>
          <Button
            aria-busy={pendingAction === "restart" || undefined}
            disabled={pendingAction !== null}
            onClick={restartLogin}
            type="button"
            variant="secondary"
          >
            {pendingAction === "restart" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            {t(
              "pier.grok.accounts.settings.addDialogReopenBrowser",
              "Reopen browser"
            )}
          </Button>
        </div>
      </div>
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
          if (value === "account" || value === "api_key") {
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
        </TabsList>

        <TabsContent className="mt-3" value="account">
          <p className="text-muted-foreground text-sm">
            {t(
              "pier.grok.accounts.settings.addDialogAccountDescription",
              "Recommended: continue in your browser to sign in with the Grok CLI. Use device code only when a browser is unavailable. The account appears here after authorization."
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
        {tab === "api_key" ? (
          <Button
            aria-busy={starting || undefined}
            disabled={starting || apiKey.trim().length === 0}
            onClick={submitApiKey}
            type="button"
          >
            {starting ? <Spinner data-icon="inline-start" /> : null}
            {t(
              "pier.grok.accounts.settings.addDialogApiKeySubmit",
              "Add API key"
            )}
          </Button>
        ) : (
          <>
            <Button
              disabled={starting}
              onClick={() => startOidc("device")}
              type="button"
              variant="outline"
            >
              {starting && oidcMode === "device" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <MonitorSmartphone data-icon="inline-start" />
              )}
              {t(
                "pier.grok.accounts.settings.addDialogDevice",
                "Use device code"
              )}
            </Button>
            <Button
              disabled={starting}
              onClick={() => startOidc("oauth")}
              type="button"
            >
              {starting && oidcMode === "oauth" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {t(
                "pier.grok.accounts.settings.addDialogContinue",
                "Continue in browser"
              )}
              <ExternalLink data-icon="inline-end" />
            </Button>
          </>
        )}
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

  const openAddDialog = useCallback((): void => {
    const handle = context.dialogs.open({
      id: ADD_DIALOG_ID,
      title: t(
        "pier.grok.accounts.settings.addDialogTitle",
        "Add Grok account"
      ),
      description: t(
        "pier.grok.accounts.settings.addDialogDescription",
        "Choose how to add a Grok account. Browser login and device code use the Grok CLI; API keys are stored only on this device."
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
