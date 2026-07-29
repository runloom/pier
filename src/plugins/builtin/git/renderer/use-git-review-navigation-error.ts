import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useEffect } from "react";
import { pluginText } from "./git-plugin-text.ts";

export function useGitReviewNavigationError(
  context: RendererPluginContext,
  navigationError: Error | null,
  retryNavigation: () => void
): void {
  useEffect(() => {
    if (!navigationError) {
      return;
    }
    context.notifications.error(
      pluginText(
        context,
        "reviewNavigationFailed",
        "Failed to navigate to file"
      ),
      {
        action: {
          label: pluginText(context, "reviewRetry", "Retry"),
          onClick: retryNavigation,
        },
      }
    );
  }, [context, navigationError, retryNavigation]);
}
