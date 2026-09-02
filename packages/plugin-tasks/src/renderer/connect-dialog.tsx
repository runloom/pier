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
import { Field, FieldError, FieldGroup, FieldLabel } from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import { type FormEvent, type JSX, useLayoutEffect, useState } from "react";
import { formatUnknownError, type Translate } from "./translate.ts";

const DIALOG_ID = "pier.tasks.connect";
const FORM_ID = "pier-tasks-connect-form";

type ConnectProvider = "jira" | "linear";

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
  const tokenId = "pier-tasks-connect-token";
  const urlId = "pier-tasks-connect-jira-url";
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
        setError(formatUnknownError(caught));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <form
      className={DIALOG_COMMIT_FORM_CLASS}
      id={FORM_ID}
      onSubmit={handleSubmit}
    >
      {error ? <FieldError>{error}</FieldError> : null}
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
        <Field>
          <FieldLabel htmlFor={tokenId}>
            {t("pier.tasks.connection.providerToken", "Access token")}
          </FieldLabel>
          <Input
            id={tokenId}
            onChange={(event) => setToken(event.target.value)}
            placeholder={provider === "linear" ? "lin_api_…" : "token"}
            type="password"
            value={token}
          />
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
            "Paste the Jira site URL and API token here. Projects are picked automatically when they load."
          )
        : t(
            "pier.tasks.panel.linearNeedAuthBody",
            "Paste a Linear API token here. Teams are picked automatically when the token works."
          ),
    id: DIALOG_ID,
    title:
      provider === "jira"
        ? t("pier.tasks.panel.jiraNeedAuthTitle", "Connect Jira to load issues")
        : t(
            "pier.tasks.panel.linearNeedAuthTitle",
            "Connect Linear to load issues"
          ),
  });
}
