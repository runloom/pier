import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import type { Translate } from "./format-account-error.ts";

/**
 * Confirm a Claude account switch. Claude has no cross-tool peer sync, so this
 * is a plain confirm dialog (no checkboxes) — the Codex/Grok equivalent
 * collapses to the same when no peers are available.
 */
export async function confirmSwitch(options: {
  context: ExternalRendererPluginContext;
  t: Translate;
}): Promise<boolean> {
  const { context, t } = options;
  return await context.dialogs.confirm({
    body: t(
      "pier.claude.accounts.settings.switchConfirmBody",
      "New Claude sessions will use this account. Restart any Claude sessions that are already running for the change to take effect."
    ),
    confirmLabel: t(
      "pier.claude.accounts.settings.switchConfirmAction",
      "Confirm"
    ),
    intent: "default",
    size: "sm",
    title: t(
      "pier.claude.accounts.settings.switchConfirmTitle",
      "Switch Claude account?"
    ),
  });
}
