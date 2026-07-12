import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import type { Translate } from "./usage-meter.tsx";

export function confirmAccountSwitch(
  context: ExternalRendererPluginContext,
  t: Translate
): Promise<boolean> {
  return context.dialogs.confirm({
    body: t(
      "pier.codex.accounts.settings.switchConfirmBody",
      "New Codex sessions will use this account. Restart any Codex sessions that are already running for the change to take effect."
    ),
    intent: "default",
    title: t(
      "pier.codex.accounts.settings.switchConfirmTitle",
      "Switch Codex account?"
    ),
  });
}
