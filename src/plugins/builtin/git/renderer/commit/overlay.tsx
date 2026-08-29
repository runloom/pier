import { Button } from "@pier/ui/button.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
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
import { Textarea } from "@pier/ui/textarea.tsx";
import type {
  RendererPluginContentDialogRenderProps,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { GIT_COMMIT_PUSH_AFTER_SETTING_KEY } from "@plugins/builtin/git/settings.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { confirmDialog } from "../command-helpers.ts";
import { pluginText } from "../plugin-text.ts";
import { useGitStatus } from "../status-state.ts";
import {
  type CommitCheckboxIntent,
  includeUnstagedChecked,
  isModEnterSubmit,
  pushAfterChecked,
} from "./defaults.ts";
import {
  isWorkingTreeEmpty,
  resolveCommitPushAfter,
  unstagedChangeCount,
} from "./paths.ts";
import {
  GitCommitBlockedError,
  GitCommitMessageError,
  submitGitCommit,
} from "./submit.ts";

const COMMIT_FORM_ID = "git-commit-form";

interface GitCommitOverlayProps {
  close: RendererPluginContentDialogRenderProps["close"];
  context: RendererPluginContext;
  cwd: string;
  initialStatus: GitStatus;
  setDismissible: RendererPluginContentDialogRenderProps["setDismissible"];
  setFooter: RendererPluginContentDialogRenderProps["setFooter"];
  setOnDismissRequest: RendererPluginContentDialogRenderProps["setOnDismissRequest"];
}

function GitCommitOverlay({
  close,
  context,
  cwd,
  initialStatus,
  setDismissible,
  setFooter,
  setOnDismissRequest,
}: GitCommitOverlayProps): React.JSX.Element {
  const messageId = useId();
  const includeId = useId();
  const pushId = useId();
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const live = useGitStatus(context, cwd);
  const lastLoadedRef = useRef(initialStatus);
  if (live.kind === "loaded") {
    lastLoadedRef.current = live.status;
  }
  const status = lastLoadedRef.current;
  const unstagedCount = unstagedChangeCount(status);
  const pushAfterState = resolveCommitPushAfter(status);
  const pushAfterPref =
    context.configuration.get<boolean>(GIT_COMMIT_PUSH_AFTER_SETTING_KEY) ===
    true;
  const [message, setMessage] = useState("");
  const [includeIntent, setIncludeIntent] =
    useState<CommitCheckboxIntent>(null);
  const [pushIntent, setPushIntent] = useState<CommitCheckboxIntent>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submittedRef = useRef(false);
  const pendingRef = useRef(false);
  const messageRef = useRef(message);
  pendingRef.current = pending;
  messageRef.current = message;
  const includeUnstaged = includeUnstagedChecked(unstagedCount, includeIntent);
  const pushAfter = pushAfterChecked(
    pushAfterState.action,
    pushAfterPref,
    pushIntent
  );
  const paused = status.repoState.kind !== "clean";
  const empty = isWorkingTreeEmpty(status);
  const canSubmit =
    message.trim().length > 0 &&
    !pending &&
    !paused &&
    !empty &&
    (status.counts.staged > 0 || includeUnstaged);

  const text = useCallback(
    (key: string, fallback: string, values?: Record<string, number | string>) =>
      pluginText(context, key, fallback, values),
    [context]
  );

  let gateError: string | null = null;
  if (paused) {
    gateError = text(
      "gitCommitPaused",
      "Continue or abort the current git operation from the status bar first."
    );
  } else if (empty) {
    gateError = text(
      "gitCommitNothing",
      "Nothing to commit. Change a file first."
    );
  }
  const displayError = gateError ?? formError;

  useLayoutEffect(() => {
    messageInputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    setDismissible(!pending);
  }, [pending, setDismissible]);

  useEffect(() => {
    setOnDismissRequest(async () => {
      if (pendingRef.current) {
        return false;
      }
      if (messageRef.current.trim().length === 0) {
        return true;
      }
      return confirmDialog(
        context,
        text("gitCommitDiscardTitle", "Discard this message?"),
        text("gitCommitDiscardBody", "You will lose what you typed."),
        text("gitCommitDiscardConfirm", "Discard"),
        undefined,
        { intent: "default" }
      );
    });
    return () => {
      setOnDismissRequest(null);
    };
  }, [context, setOnDismissRequest, text]);

  useLayoutEffect(() => {
    setFooter(
      <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
        <Button
          disabled={pending}
          onClick={() => {
            close();
          }}
          type="button"
          variant="outline"
        >
          {context.i18n.t("ui.cancel", undefined, "Cancel")}
        </Button>
        <Button
          disabled={!canSubmit}
          form={COMMIT_FORM_ID}
          type="submit"
          variant="default"
        >
          {text("gitCommit", "Commit")}
        </Button>
      </div>
    );
    return () => {
      setFooter(null);
    };
  }, [canSubmit, close, context.i18n, pending, setFooter, text]);

  async function onSubmit(event: {
    preventDefault: () => void;
  }): Promise<void> {
    event.preventDefault();
    if (submittedRef.current || !canSubmit) {
      if (!canSubmit && message.trim().length > 0 && !paused && !empty) {
        setFormError(
          text(
            "gitCommitNoStaged",
            "Nothing is staged. Stage files in Changes, or include unstaged changes."
          )
        );
      }
      return;
    }
    submittedRef.current = true;
    setPending(true);
    setFormError(null);
    try {
      await submitGitCommit({
        context,
        cwd,
        includeIntent,
        message,
        onCommitted: () => {
          close();
          context.notifications.success(text("gitCommitSuccess", "Committed"));
        },
        pushAfterPref,
        pushIntent,
      });
    } catch (error) {
      submittedRef.current = false;
      setPending(false);
      if (error instanceof GitCommitMessageError) {
        setFormError(
          text("gitCommitMessageRequired", "Enter a commit message.")
        );
        return;
      }
      if (error instanceof GitCommitBlockedError) {
        if (error.kind === "paused") {
          setFormError(
            text(
              "gitCommitPaused",
              "Continue or abort the current git operation from the status bar first."
            )
          );
          return;
        }
        if (error.kind === "empty") {
          setFormError(
            text("gitCommitNothing", "Nothing to commit. Change a file first.")
          );
          return;
        }
        setFormError(
          text(
            "gitCommitNoStaged",
            "Nothing is staged. Stage files in Changes, or include unstaged changes."
          )
        );
        return;
      }
      await context.dialogs.alert({
        body: error instanceof Error ? error.message : String(error),
        title: text("gitCommitFailed", "Couldn't commit"),
      });
    }
  }

  let pushDisabledReason: string | null = null;
  if (pushAfterState.disabledReason === "auth") {
    pushDisabledReason = text(
      "gitCommitPushAuth",
      "Sign in to the remote, then try again."
    );
  } else if (pushAfterState.disabledReason === "unavailable") {
    pushDisabledReason = text(
      "gitCommitPushUnavailable",
      "Can't push to a remote right now."
    );
  }

  return (
    <form
      className={DIALOG_COMMIT_FORM_CLASS}
      data-slot="dialog-commit-form"
      id={COMMIT_FORM_ID}
      onSubmit={onSubmit}
    >
      <FieldGroup className={DIALOG_COMMIT_FIELD_GROUP_CLASS}>
        <Field>
          <FieldLabel htmlFor={messageId}>
            {text("gitCommitMessage", "Commit message")}
          </FieldLabel>
          <Textarea
            aria-invalid={displayError !== null}
            id={messageId}
            onChange={(event) => {
              setMessage(event.target.value);
              if (formError) {
                setFormError(null);
              }
            }}
            onKeyDown={(event) => {
              if (isModEnterSubmit(event) && canSubmit) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={text(
              "gitCommitMessagePlaceholder",
              "What did you change?"
            )}
            ref={messageInputRef}
            value={message}
          />
          <FieldDescription>
            {text(
              "gitCommitCounts",
              "{{staged}} staged · {{unstaged}} unstaged",
              {
                staged: status.counts.staged,
                unstaged: unstagedCount,
              }
            )}
          </FieldDescription>
          {displayError ? <FieldError>{displayError}</FieldError> : null}
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            checked={includeUnstaged}
            disabled={unstagedCount === 0 || pending}
            id={includeId}
            onCheckedChange={(value) => {
              setIncludeIntent(value === true);
            }}
          />
          <FieldLabel htmlFor={includeId}>
            {text("gitCommitIncludeUnstaged", "Include unstaged changes")}
          </FieldLabel>
        </Field>
        {pushAfterState.visible ? (
          <Field orientation="horizontal">
            <Checkbox
              checked={pushAfter}
              disabled={pushAfterState.action === null || pending}
              id={pushId}
              onCheckedChange={(value) => {
                setPushIntent(value === true);
              }}
            />
            <FieldLabel htmlFor={pushId}>
              {text("gitCommitPushAfter", "Push after commit")}
            </FieldLabel>
          </Field>
        ) : null}
        {pushDisabledReason ? (
          <FieldDescription>{pushDisabledReason}</FieldDescription>
        ) : null}
      </FieldGroup>
    </form>
  );
}

export function openGitCommitOverlay(
  context: RendererPluginContext,
  input: { cwd: string; status: GitStatus }
): void {
  context.dialogs.open({
    description: pluginText(
      context,
      "gitCommitDescription",
      "Commit the current changes."
    ),
    id: "git-commit",
    size: "sm",
    title: pluginText(context, "gitCommitTitle", "Commit"),
    content: ({ close, setDismissible, setFooter, setOnDismissRequest }) => (
      <GitCommitOverlay
        close={close}
        context={context}
        cwd={input.cwd}
        initialStatus={input.status}
        setDismissible={setDismissible}
        setFooter={setFooter}
        setOnDismissRequest={setOnDismissRequest}
      />
    ),
  });
}
