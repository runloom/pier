import type {
  ExternalRendererPluginContext,
  RendererPluginContentDialogRenderProps,
} from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import {
  DIALOG_COMMIT_FIELD_GROUP_CLASS,
  DIALOG_COMMIT_FORM_CLASS,
  DIALOG_FOOTER_ACTIONS_CLASS,
} from "@pier/ui/dialog-form-layout.ts";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@pier/ui/input-group.tsx";
import { ExternalLink } from "lucide-react";
import {
  type FormEvent,
  type JSX,
  useId,
  useLayoutEffect,
  useState,
} from "react";
import {
  JIRA_API_TOKENS_URL,
  LINEAR_PERSONAL_API_KEYS_URL,
} from "../shared/constants.ts";
import { formatUnknownError, type Translate } from "./translate.ts";

const DIALOG_ID = "pier.tasks.connect";
const FORM_ID = "pier-tasks-connect-form";

type ConnectProvider = "jira" | "linear";

function isAuthError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /not authorized|HTTP 401|HTTP 403/i.test(error.message)
  );
}

function ConnectForm({
  close,
  context,
  initialJiraBaseUrl,
  onDone,
  provider,
  setFooter,
  t,
}: RendererPluginContentDialogRenderProps & {
  context: ExternalRendererPluginContext;
  initialJiraBaseUrl: string;
  onDone: () => void;
  provider: ConnectProvider;
  t: Translate;
}): JSX.Element {
  const [token, setToken] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState(initialJiraBaseUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tokenId = useId();
  const urlId = useId();
  const createKeyUrl =
    provider === "linear" ? LINEAR_PERSONAL_API_KEYS_URL : JIRA_API_TOKENS_URL;
  const canSubmit =
    token.trim().length > 0 &&
    (provider === "linear" || jiraBaseUrl.trim().length > 0);

  useLayoutEffect(() => {
    setFooter(
      <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
        <Button
          disabled={saving}
          onClick={() => close(null)}
          type="button"
          variant="outline"
        >
          {t("pier.tasks.connection.cancel", "Cancel")}
        </Button>
        <Button disabled={saving || !canSubmit} form={FORM_ID} type="submit">
          {t("pier.tasks.panel.connect", "Connect")}
        </Button>
      </div>
    );
    return () => {
      setFooter(null);
    };
  }, [canSubmit, close, saving, setFooter, t]);

  const openCreateKey = (): void => {
    context.app
      .openExternal(createKeyUrl)
      .then((opened) => {
        if (!opened) {
          setError(
            t(
              "pier.tasks.connection.openCreateKeyFailed",
              "Couldn't open the browser. Create the key on the site, then paste it here."
            )
          );
        }
      })
      .catch((caught: unknown) => {
        setError(formatUnknownError(caught));
      });
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!canSubmit || saving) {
      return;
    }
    setSaving(true);
    const work = async () => {
      if (provider === "jira") {
        await context.rpc.invoke("connection.setJiraBaseUrl", {
          url: jiraBaseUrl.trim(),
        });
      }
      await context.rpc.invoke("connection.setProviderToken", {
        provider,
        token: token.trim(),
      });
    };
    work()
      .then(() => {
        close(true);
        onDone();
      })
      .catch((caught: unknown) => {
        if (provider === "linear" && isAuthError(caught)) {
          setError(
            t(
              "pier.tasks.connection.linearTokenInvalid",
              "This Linear key didn't work. Create a new key in Linear and paste it again."
            )
          );
          return;
        }
        if (provider === "jira" && isAuthError(caught)) {
          setError(
            t(
              "pier.tasks.connection.jiraTokenInvalid",
              "This Jira token didn't work. Check the site URL and create a new token, then try again."
            )
          );
          return;
        }
        setError(formatUnknownError(caught));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <form
      className={DIALOG_COMMIT_FORM_CLASS}
      data-slot="dialog-commit-form"
      id={FORM_ID}
      onSubmit={handleSubmit}
    >
      <FieldGroup className={DIALOG_COMMIT_FIELD_GROUP_CLASS}>
        {provider === "jira" ? (
          <Field>
            <FieldLabel htmlFor={urlId}>
              {t("pier.tasks.connection.jiraBaseUrl", "Jira site URL")}
            </FieldLabel>
            <Input
              id={urlId}
              onChange={(event) => setJiraBaseUrl(event.target.value)}
              placeholder="https://example.atlassian.net"
              value={jiraBaseUrl}
            />
          </Field>
        ) : null}
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={tokenId}>
            {provider === "linear"
              ? t("pier.tasks.connection.linearAccessKey", "Access key")
              : t("pier.tasks.connection.providerToken", "Access token")}
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              aria-invalid={error ? true : undefined}
              autoFocus
              id={tokenId}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                provider === "linear"
                  ? t(
                      "pier.tasks.connection.linearAccessKeyPlaceholder",
                      "Paste access key"
                    )
                  : t(
                      "pier.tasks.connection.providerTokenPlaceholder",
                      "Paste access token"
                    )
              }
              type="password"
              value={token}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                disabled={saving}
                onClick={openCreateKey}
                type="button"
              >
                {provider === "linear"
                  ? t("pier.tasks.connection.openLinear", "Open Linear")
                  : t("pier.tasks.connection.openJira", "Open Atlassian")}
                <ExternalLink data-icon="inline-end" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {error ? (
            <FieldError>{error}</FieldError>
          ) : (
            <FieldDescription>
              {provider === "linear"
                ? t(
                    "pier.tasks.connection.linearTokenDescription",
                    "Linear shows the key once."
                  )
                : t(
                    "pier.tasks.connection.jiraTokenDescription",
                    "Atlassian shows the token once — paste it with the site URL."
                  )}
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>
    </form>
  );
}

export function openConnectDialog(options: {
  context: ExternalRendererPluginContext;
  jiraBaseUrl?: string;
  onDone: () => void;
  provider: ConnectProvider;
  t: Translate;
}): void {
  const { context, jiraBaseUrl, onDone, provider, t } = options;
  context.dialogs.open({
    content: (renderProps) => (
      <div className="contents" data-pier-tasks-scope="">
        <ConnectForm
          {...renderProps}
          context={context}
          initialJiraBaseUrl={jiraBaseUrl ?? ""}
          onDone={onDone}
          provider={provider}
          t={t}
        />
      </div>
    ),
    description:
      provider === "jira"
        ? t(
            "pier.tasks.panel.jiraNeedAuthBody",
            "Create an API token at Atlassian, then paste the site URL and token here. Projects are picked automatically when they load."
          )
        : t(
            "pier.tasks.panel.linearNeedAuthBody",
            "Open Linear to create an access key, then paste it back here. Teams are picked automatically when it works."
          ),
    id: DIALOG_ID,
    size: "sm",
    title:
      provider === "jira"
        ? t("pier.tasks.connection.connectJiraTitle", "Connect Jira")
        : t("pier.tasks.connection.connectLinearTitle", "Connect Linear"),
  });
}
