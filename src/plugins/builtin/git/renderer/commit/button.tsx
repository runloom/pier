import { Button } from "@pier/ui/button.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { commandTitle, showError } from "../command-helpers.ts";
import { pluginText } from "../plugin-text.ts";
import { runGitCommitCommand } from "./action.ts";

export function GitReviewCommitButton({
  className,
  context,
}: {
  readonly className?: string;
  readonly context: RendererPluginContext;
}): React.JSX.Element {
  return (
    <Button
      className={className}
      data-testid="git-review-commit"
      onClick={() => {
        runGitCommitCommand(context).catch((error: unknown) => {
          showError(
            context,
            commandTitle(context, "pier.git.commit", "GIT: Commit"),
            error
          ).catch(() => undefined);
        });
      }}
      type="button"
      variant="default"
    >
      {pluginText(context, "gitCommit", "Commit")}
    </Button>
  );
}
