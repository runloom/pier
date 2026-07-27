import type {
  ExternalRendererPluginContext,
  RendererPluginContentDialogRenderProps,
} from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import { DIALOG_FOOTER_ACTIONS_CLASS } from "@pier/ui/dialog-form-layout.ts";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import { Globe, HardDrive, ShieldCheck } from "lucide-react";
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClaudeLoginState } from "../shared/accounts.ts";
import { OauthWaiting } from "./add-account-waiting.tsx";
import type { Translate } from "./format-account-error.ts";
import { useClaudeAccountsSnapshot } from "./use-accounts-snapshot.ts";

function isLoginCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "Login cancelled")
  );
}

type AddTab = "oauth" | "local";

type AddAccountContentProps = RendererPluginContentDialogRenderProps & {
  context: ExternalRendererPluginContext;
  initialLogin: ClaudeLoginState | null;
  onError: (error: unknown) => void;
  t: Translate;
};

export function AddAccountContent({
  close,
  context,
  initialLogin,
  onError,
  setDescription,
  setDismissible,
  setFooter,
  setTitle,
  t,
}: AddAccountContentProps): JSX.Element {
  // Read login state live from the snapshot store: the dialog host freezes
  // content props at open time, so a `login` prop would go permanently stale.
  const { snapshot } = useClaudeAccountsSnapshot(context);
  const login = snapshot ? (snapshot.login ?? null) : initialLogin;
  const [tab, setTab] = useState<AddTab>("oauth");
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "cancel" | "restart" | null
  >(null);
  const [code, setCode] = useState("");
  const operationId = useRef(0);
  const previousLogin = useRef<ClaudeLoginState | null>(initialLogin);

  // While a login is live: waiting-state title/description + non-dismissible.
  // When it ends (completed or cancelled from any window): restore both.
  // A session restart (new startedAt) clears the consumed code — the old
  // code is dead and must not invite a doomed resubmit.
  useEffect(() => {
    if (login) {
      setDismissible(false);
      setTitle(
        t(
          "pier.claude.accounts.settings.addDialogWaitingTitle",
          "Waiting for authorization"
        )
      );
      setDescription(
        t(
          "pier.claude.accounts.settings.addDialogWaitingDescription",
          "Authorize in the browser, then paste the code from the callback page."
        )
      );
      if (previousLogin.current?.startedAt !== login.startedAt) {
        setCode("");
      }
    } else if (previousLogin.current) {
      setDismissible(true);
      setTitle(
        t("pier.claude.accounts.settings.addDialogTitle", "Add Claude account")
      );
      setDescription(
        t(
          "pier.claude.accounts.settings.addDialogDescription",
          "Sign in with the browser, or import the account already signed in with the Claude CLI."
        )
      );
    }
    previousLogin.current = login;
  }, [login, setDescription, setDismissible, setTitle, t]);

  const startOauth = (): void => {
    const currentOperation = ++operationId.current;
    setStarting(true);
    setDismissible(false);
    context.rpc
      .invoke("accounts.add", { kind: "oauth" })
      .then(() => {
        // The login session is now live; snapshot.login carries the URL.
        // Open the browser immediately for a smooth flow. Failures here are
        // conveniences failing (the waiting screen still shows the link), so
        // they must NOT unlock the waiting dialog's dismissibility.
        context.rpc
          .invoke<{ login: ClaudeLoginState | null }>("accounts.snapshot", null)
          .then((fresh) => {
            if (fresh.login?.authorizeUrl) {
              return context.app.openExternal(fresh.login.authorizeUrl);
            }
            return true;
          })
          .catch(() => undefined);
      })
      .catch((error: unknown) => {
        // No login started — restore dismissibility and report.
        setDismissible(true);
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

  const completeLogin = (): void => {
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      return;
    }
    const currentOperation = ++operationId.current;
    setCompleting(true);
    context.rpc
      .invoke("accounts.completeLogin", { code: trimmed })
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
          // Keep the dialog open: the user can fix a mistyped code.
          onError(error);
        }
      })
      .finally(() => {
        if (operationId.current === currentOperation) {
          setCompleting(false);
        }
      });
  };

  const cancelLogin = (): void => {
    operationId.current += 1;
    // The bumped operationId skips the aborted complete's own reset; clear
    // the busy flags here so a failed cancel RPC cannot strand the dialog.
    setCompleting(false);
    setStarting(false);
    setPendingAction("cancel");
    context.rpc
      .invoke("accounts.cancelLogin", null)
      .then(() => {
        setDismissible(true);
        close(null);
      })
      .catch(onError)
      .finally(() => {
        setPendingAction(null);
      });
  };

  const restartLogin = (): void => {
    operationId.current += 1;
    setCompleting(false);
    setPendingAction("restart");
    context.rpc
      .invoke("accounts.cancelLogin", null)
      .then(() => {
        setPendingAction(null);
        startOauth();
      })
      .catch((error: unknown) => {
        onError(error);
      })
      .finally(() => {
        setPendingAction(null);
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

  const adoptLocalRef = useRef(adoptLocal);
  const startOauthRef = useRef(startOauth);
  const cancelLoginRef = useRef(cancelLogin);
  const completeLoginRef = useRef(completeLogin);
  const restartLoginRef = useRef(restartLogin);
  adoptLocalRef.current = adoptLocal;
  startOauthRef.current = startOauth;
  cancelLoginRef.current = cancelLogin;
  completeLoginRef.current = completeLogin;
  restartLoginRef.current = restartLogin;

  // Single owner for sticky footer across authorize + OAuth waiting stages.
  useLayoutEffect(() => {
    if (login) {
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
            {t("pier.claude.accounts.settings.cancelLogin", "Cancel login")}
          </Button>
          <Button
            aria-busy={pendingAction === "restart" || undefined}
            disabled={pendingAction !== null || completing}
            onClick={() => {
              restartLoginRef.current();
            }}
            type="button"
            variant="secondary"
          >
            {pendingAction === "restart" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            {t("pier.claude.accounts.settings.addDialogRestart", "Start over")}
          </Button>
          <Button
            aria-busy={completing || undefined}
            disabled={
              completing || pendingAction !== null || code.trim().length === 0
            }
            onClick={() => {
              completeLoginRef.current();
            }}
            type="button"
          >
            {completing ? <Spinner data-icon="inline-start" /> : null}
            {t(
              "pier.claude.accounts.settings.addDialogComplete",
              "Complete login"
            )}
          </Button>
        </div>
      );
    } else {
      setFooter(
        <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
          <Button
            disabled={starting}
            onClick={() => close(null)}
            type="button"
            variant="outline"
          >
            {t("pier.claude.accounts.settings.cancel", "Cancel")}
          </Button>
          {tab === "local" ? (
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
                "pier.claude.accounts.settings.addDialogLocalSubmit",
                "Import current login"
              )}
            </Button>
          ) : (
            <Button
              aria-busy={starting || undefined}
              disabled={starting}
              onClick={() => {
                startOauthRef.current();
              }}
              type="button"
            >
              {starting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Globe data-icon="inline-start" />
              )}
              {t(
                "pier.claude.accounts.settings.addDialogOauthSubmit",
                "Sign in with browser"
              )}
            </Button>
          )}
        </div>
      );
    }
    return () => {
      setFooter(null);
    };
  }, [
    close,
    code,
    completing,
    login,
    pendingAction,
    setFooter,
    starting,
    t,
    tab,
  ]);

  if (login) {
    return (
      <OauthWaiting
        authorizeUrl={login.authorizeUrl}
        code={code}
        context={context}
        onCodeChange={setCode}
        onError={onError}
        t={t}
      />
    );
  }

  return (
    <div
      className="flex flex-col gap-4"
      data-pier-claude-scope=""
      data-slot="dialog-commit-form"
    >
      <Item size="sm" variant="muted">
        <ItemMedia variant="icon">
          <ShieldCheck aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemDescription>
            {t(
              "pier.claude.accounts.settings.addDialogLocalCredential",
              "Credentials are stored only on this device"
            )}
          </ItemDescription>
        </ItemContent>
      </Item>

      <Tabs
        onValueChange={(value) => {
          if (value === "oauth" || value === "local") {
            setTab(value);
          }
        }}
        value={tab}
      >
        <TabsList className="w-full">
          <TabsTrigger className="flex-1" value="oauth">
            {t(
              "pier.claude.accounts.settings.addDialogTabOauth",
              "Browser login"
            )}
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="local">
            {t(
              "pier.claude.accounts.settings.addDialogTabLocal",
              "Local import"
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent className="mt-3" value="oauth">
          <p className="text-muted-foreground text-sm">
            {t(
              "pier.claude.accounts.settings.addDialogOauthDescription",
              "Sign in with your Claude account in the browser, then paste the authorization code shown on the callback page."
            )}
          </p>
        </TabsContent>

        <TabsContent className="mt-3" value="local">
          <p className="text-muted-foreground text-sm">
            {t(
              "pier.claude.accounts.settings.addDialogLocalDescription",
              "Import the account already signed in on this device. It becomes the active Pier account."
            )}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
