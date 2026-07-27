import type {
  ExternalRendererPluginContext,
  RendererPluginContentDialogRenderProps,
} from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import {
  DIALOG_COMMIT_FIELD_GROUP_CLASS,
  DIALOG_FOOTER_ACTIONS_CLASS,
} from "@pier/ui/dialog-form-layout.ts";
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
import { HardDrive, MonitorSmartphone, ShieldCheck } from "lucide-react";
import {
  type JSX,
  useEffect,
  useId,
  useLayoutEffect,
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

type AddAccountContentProps = RendererPluginContentDialogRenderProps & {
  context: ExternalRendererPluginContext;
  initialLogin: GrokLoginState | null;
  onError: (error: unknown) => void;
  t: Translate;
};
export function AddAccountContent({
  context,
  onError,
  t,
  close,
  setDismissible,
  setFooter,
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
  const submitApiKeyRef = useRef(submitApiKey);
  const adoptLocalRef = useRef(adoptLocal);
  const startDeviceLoginRef = useRef(startDeviceLogin);
  const cancelLoginRef = useRef(cancelLogin);
  const restartLoginRef = useRef(restartLogin);
  submitApiKeyRef.current = submitApiKey;
  adoptLocalRef.current = adoptLocal;
  startDeviceLoginRef.current = startDeviceLogin;
  cancelLoginRef.current = cancelLogin;
  restartLoginRef.current = restartLogin;

  // Single owner for sticky footer across choose + waiting stages.
  useLayoutEffect(() => {
    if (presentation === "waiting") {
      setFooter(
        <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
          <Button
            aria-busy={pendingAction === "cancel" || undefined}
            disabled={pendingAction !== null}
            onClick={() => {
              cancelLoginRef.current();
            }}
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
            onClick={() => {
              restartLoginRef.current();
            }}
            type="button"
            variant="secondary"
          >
            {pendingAction === "restart" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            {t(
              "pier.grok.accounts.settings.addDialogRestartDevice",
              "Request a new code"
            )}
          </Button>
        </div>
      );
    } else {
      let primary: JSX.Element;
      if (tab === "api_key") {
        primary = (
          <Button
            aria-busy={starting || undefined}
            disabled={starting || apiKey.trim().length === 0}
            onClick={() => {
              submitApiKeyRef.current();
            }}
            type="button"
          >
            {starting ? <Spinner data-icon="inline-start" /> : null}
            {t(
              "pier.grok.accounts.settings.addDialogApiKeySubmit",
              "Add API key"
            )}
          </Button>
        );
      } else if (tab === "local") {
        primary = (
          <Button
            aria-busy={starting || undefined}
            disabled={starting}
            onClick={() => {
              adoptLocalRef.current();
            }}
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
        primary = (
          <Button
            disabled={starting}
            onClick={() => {
              startDeviceLoginRef.current();
            }}
            type="button"
          >
            {starting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <MonitorSmartphone data-icon="inline-start" />
            )}
            {t(
              "pier.grok.accounts.settings.addDialogDevice",
              "Use device code"
            )}
          </Button>
        );
      }
      setFooter(
        <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
          <Button
            disabled={waiting}
            onClick={() => close(null)}
            type="button"
            variant="outline"
          >
            {t("pier.grok.accounts.settings.cancel", "Cancel")}
          </Button>
          {primary}
        </div>
      );
    }
    return () => {
      setFooter(null);
    };
  }, [
    apiKey,
    close,
    pendingAction,
    presentation,
    setFooter,
    starting,
    t,
    tab,
    waiting,
  ]);

  if (presentation === "waiting") {
    return (
      <AddAccountWaiting
        deviceCode={login?.deviceCode}
        deviceVerificationUrl={login?.deviceVerificationUrl}
        onOpenVerificationUrl={(url) => {
          context.app.openExternal(url).catch(onError);
        }}
        t={t}
      />
    );
  }

  return (
    <div
      className="flex flex-col gap-4"
      data-pier-grok-scope=""
      data-slot="dialog-commit-form"
    >
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
            <FieldGroup className={DIALOG_COMMIT_FIELD_GROUP_CLASS}>
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
    </div>
  );
}
