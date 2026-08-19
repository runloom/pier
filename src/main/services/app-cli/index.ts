import { createLogger } from "@shared/logger.ts";
import { createAppCliHost, inspectAppCli, installAppCli } from "./install.ts";

export type { AppCliHost } from "./install.ts";
export {
  createAppCliHost,
  inspectAppCli,
  installAppCli,
  uninstallAppCli,
} from "./install.ts";

const log = createLogger("app-cli");

/** After login-shell PATH is applied: link `pier` when the dest dir is writable. */
export async function maybeInstallPackagedCliOnPath(): Promise<void> {
  const host = createAppCliHost();
  if (host.isDev || host.platform !== "darwin") {
    return;
  }
  const status = inspectAppCli(host);
  if (
    status.installed ||
    status.needsAdmin ||
    status.conflictPath ||
    status.actionError
  ) {
    return;
  }
  const result = await installAppCli({ allowAdmin: false, host });
  if (!(result.actionOk && result.installed)) {
    log.warn("auto-install did not finish", {
      actionError: result.actionError,
      detail: result.detail,
      linkPath: result.linkPath,
    });
  }
}
