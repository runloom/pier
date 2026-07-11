import type { ManagedPluginRendererActivationReport } from "@shared/contracts/managed-plugin.ts";

export type ExternalActivationReporter = (
  report: ManagedPluginRendererActivationReport
) => Promise<void>;

export const defaultExternalActivationReporter: ExternalActivationReporter =
  async (report) => {
    const reporter = window.pier?.managedPlugins.reportRendererActivation;
    if (typeof reporter === "function") {
      await reporter(report);
    }
  };

export async function safelyReportExternalActivation(
  reporter: ExternalActivationReporter,
  report: ManagedPluginRendererActivationReport
): Promise<void> {
  try {
    await reporter(report);
  } catch (error) {
    console.error(
      `[renderer-plugin-runtime] failed to report ${report.pluginId} activation:`,
      error
    );
  }
}
