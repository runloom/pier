import { GHOSTTY_HOST_MESSAGE_CATALOG } from "@shared/contracts/ghostty-host-copy.ts";
import i18next from "i18next";

/**
 * Resolve catalog leaves to the current UI language and push to native.
 *
 * Used by:
 * - paste confirm (host NSAlert)
 * - Thread.zig startup failures (0105 → ghostty_host_messages_get)
 * - Surface.zig process-exit **fallback** only (when action not consumed)
 *
 * Process-exit **main path** does not use this table for final text —
 * renderer injects a fully resolved string via injectDisplayText.
 */
export function buildHostCopyCatalog(
  t: (key: string) => string = (key) => i18next.t(key)
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const descriptor of Object.values(GHOSTTY_HOST_MESSAGE_CATALOG)) {
    const leaf = descriptor.i18nKey.replace(/^ghosttyHost\./, "");
    const fullKey = `terminal.${descriptor.i18nKey}`;
    out[leaf] = t(fullKey);
  }
  // Surface.zig fallback single line when SHOW_CHILD_EXITED is not consumed.
  const primary = out.processExited ?? t("terminal.ghosttyHost.processExited");
  const dismiss = out.dismissAnyKey ?? t("terminal.ghosttyHost.dismissAnyKey");
  out.processExitedWithDismiss = `${primary}. ${dismiss}`;
  return out;
}

export async function pushHostCopyCatalog(): Promise<void> {
  const api = window.pier?.terminal;
  if (!api?.setHostCopyCatalog) {
    return;
  }
  const messages = buildHostCopyCatalog();
  await api.setHostCopyCatalog(messages);
}
