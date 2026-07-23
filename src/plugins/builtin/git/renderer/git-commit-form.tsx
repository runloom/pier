import { Button } from "@pier/ui/button.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useState } from "react";
import { showError } from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";

/**
 * Changes 面板侧栏底部的提交区。只在 uncommitted scope 且存在 staged
 * 变更时渲染；提交成功后依赖 main 侧 post-op pulse 自动刷新 index。
 * AI 草稿 / Push·Publish 仍属 commit-mainline 后续任务。
 */
export function GitCommitForm({
  context,
  cwd,
  stagedCount,
}: {
  readonly context: RendererPluginContext;
  readonly cwd: string;
  readonly stagedCount: number;
}): React.JSX.Element {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = message.trim();
  const disabled = submitting || trimmed.length === 0;

  const submit = async () => {
    if (disabled) {
      return;
    }
    setSubmitting(true);
    try {
      await context.git.commit(cwd, { message: trimmed });
      setMessage("");
      context.notifications.success(
        pluginText(context, "commitSuccess", "Changes committed")
      );
    } catch (error) {
      await showError(
        context,
        pluginText(context, "commitFailed", "Commit failed"),
        error
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="flex shrink-0 flex-col gap-1.5 border-border border-t p-2"
      data-testid="git-commit-form"
    >
      <Textarea
        aria-label={pluginText(context, "commitMessageLabel", "Commit message")}
        className="max-h-32 min-h-14"
        disabled={submitting}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit().catch(() => undefined);
          }
        }}
        placeholder={pluginText(
          context,
          "commitMessagePlaceholder",
          "Commit message"
        )}
        value={message}
      />
      <Button
        className="w-full"
        disabled={disabled}
        onClick={() => {
          submit().catch(() => undefined);
        }}
        size="sm"
        type="button"
      >
        {pluginText(context, "commitButton", "Commit {{count}} staged", {
          count: stagedCount,
        })}
      </Button>
    </div>
  );
}
