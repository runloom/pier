import type { RendererPluginContext } from "@plugins/api/renderer.ts";

export async function showFileDurabilityError(
  context: RendererPluginContext,
  message: string
): Promise<void> {
  await context.dialogs.alert({
    body: message,
    title: context.i18n.t(
      "filePanel.durability.confirmFailed",
      undefined,
      "Unable to confirm that the file was saved"
    ),
  });
}

export async function showFilesDraftProtectionError(
  context: RendererPluginContext,
  message: string
): Promise<void> {
  await context.dialogs.alert({
    body: message,
    title: context.i18n.t(
      "files.draftProtection.failed",
      undefined,
      "Unable to auto-save draft"
    ),
  });
}
