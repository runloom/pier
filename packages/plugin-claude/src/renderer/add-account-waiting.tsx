import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import { DIALOG_COMMIT_FIELD_GROUP_CLASS } from "@pier/ui/dialog-form-layout.ts";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@pier/ui/item.tsx";
import { ExternalLink, Globe } from "lucide-react";
import { type JSX, useId } from "react";
import type { Translate } from "./format-account-error.ts";

/**
 * Waiting-stage body only — parent owns sticky footer (single setFooter owner).
 * Paste code + open authorize URL live here; Cancel / Start over / Complete are footer.
 */
export function OauthWaiting({
  authorizeUrl,
  code,
  context,
  onCodeChange,
  onError,
  t,
}: {
  authorizeUrl: string;
  code: string;
  completing?: boolean;
  context: ExternalRendererPluginContext;
  onCancel?: () => void;
  onCodeChange: (value: string) => void;
  onComplete?: () => void;
  onError: (error: unknown) => void;
  onRestart?: () => void;
  pendingAction?: "cancel" | "restart" | null;
  t: Translate;
}): JSX.Element {
  const codeInputId = useId();

  return (
    <div
      className="flex flex-col gap-4"
      data-pier-claude-scope=""
      data-slot="dialog-commit-form"
    >
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
        <FieldGroup className={DIALOG_COMMIT_FIELD_GROUP_CLASS}>
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
    </div>
  );
}
