import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { consumeFilesDraftRecoveryDiagnostics } from "./files-document-drafts.ts";

export class FilesDraftRecoveryReporter {
  readonly #reported = new Set<string>();

  async reportAvailable(context: RendererPluginContext): Promise<void> {
    const diagnostics = await context.files.drafts.listDiagnostics?.();
    const messages = [
      ...(diagnostics?.map(({ message }) => message) ?? []),
      ...consumeFilesDraftRecoveryDiagnostics(),
    ];
    if (messages.length) await this.report(context, messages.join("\n"));
  }

  async report(context: RendererPluginContext, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (this.#reported.has(message)) return;
    this.#reported.add(message);
    await context.dialogs.alert({
      body: message,
      size: "default",
      title: context.i18n.t(
        "files.draftRecovery.failed",
        undefined,
        "Unable to restore saved drafts"
      ),
    });
  }
}
