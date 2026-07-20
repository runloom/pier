import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
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
import { ExternalLink, Globe } from "lucide-react";
import { type JSX, useId } from "react";
import type { Translate } from "./format-account-error.ts";

/**
 * Waiting stage of the browser OAuth login: open the authorize URL, paste
 * the code from the callback page, complete/cancel/restart.
 */
export function OauthWaiting({
  authorizeUrl,
  code,
  completing,
  context,
  onCancel,
  onCodeChange,
  onComplete,
  onError,
  onRestart,
  pendingAction,
  t,
}: {
  authorizeUrl: string;
  code: string;
  completing: boolean;
  context: ExternalRendererPluginContext;
  onCancel: () => void;
  onCodeChange: (value: string) => void;
  onComplete: () => void;
  onError: (error: unknown) => void;
  onRestart: () => void;
  pendingAction: "cancel" | "restart" | null;
  t: Translate;
}): JSX.Element {
  const codeInputId = useId();
  return (
    <div className="flex flex-col gap-4" data-pier-claude-scope="">
      <Item size="sm" variant="muted">
        <ItemMedia variant="icon">
          <Globe aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemDescription>
            {t(
              "pier.claude.accounts.settings.addDialogOauthStep",
              "Authorize in the browser, then paste the code shown on the callback page below."
            )}
          </ItemDescription>
        </ItemContent>
      </Item>
      <Button
        className="self-start"
        data-testid="claude-authorize-url"
        onClick={() => {
          context.app.openExternal(authorizeUrl).catch(onError);
        }}
        type="button"
        variant="link"
      >
        {t(
          "pier.claude.accounts.settings.addDialogOpenBrowser",
          "Open the Claude authorization page"
        )}
        <ExternalLink data-icon="inline-end" />
      </Button>
      <FieldSet>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={codeInputId}>
              {t(
                "pier.claude.accounts.settings.addDialogCode",
                "Authorization code"
              )}
            </FieldLabel>
            <Input
              autoComplete="off"
              id={codeInputId}
              onChange={(event) => onCodeChange(event.target.value)}
              placeholder={t(
                "pier.claude.accounts.settings.addDialogCodePlaceholder",
                "Paste the code from the callback page"
              )}
              spellCheck={false}
              value={code}
            />
          </Field>
        </FieldGroup>
      </FieldSet>
      <div className="flex flex-wrap justify-end gap-2">
        {/* Cancel stays enabled while completing: it aborts a hung exchange. */}
        <Button
          aria-busy={pendingAction === "cancel" || undefined}
          disabled={pendingAction !== null}
          onClick={onCancel}
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
          onClick={onRestart}
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
          onClick={onComplete}
          type="button"
        >
          {completing ? <Spinner data-icon="inline-start" /> : null}
          {t(
            "pier.claude.accounts.settings.addDialogComplete",
            "Complete login"
          )}
        </Button>
      </div>
    </div>
  );
}
