/**
 * User-facing copy for the language-service status chip (badge + hover card).
 * Prefer action-oriented guidance over internal reason codes.
 */

import type { FilesTranslate } from "../i18n.ts";
import type { FilesLanguageServiceStatus } from "./language-service-status.ts";
import { lspInstallGuideRegistry } from "./lsp-install-guide-registry.ts";

export type LanguageServiceTone =
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";

export interface LanguageServicePresentation {
  /** Optional install / settings command shown in mono. */
  command?: string;
  /** Longer body for the hover card. */
  description: string;
  /** Short chip label. */
  label: string;
  /** One-line next step under the body. */
  nextStep?: string;
  /** Hover card title (what happened). */
  title: string;
  tone: LanguageServiceTone;
}

/**
 * Resolve display name + install command from language plugins / core catalog
 * (via install-guide registry). Files does not hardcode per-language install.
 */
function serverDisplayName(
  serverId: string | undefined,
  t: FilesTranslate
): string {
  if (!serverId) {
    return t("filePanel.languageService.server.generic", "this language");
  }
  const guide = lspInstallGuideRegistry.get(serverId);
  if (guide) {
    return guide.displayName;
  }
  if (serverId.startsWith("custom:")) {
    return serverId.slice("custom:".length);
  }
  if (serverId.includes(":")) {
    return serverId.split(":").at(-1) ?? serverId;
  }
  return serverId;
}

function installCommandForServer(
  serverId: string | undefined
): string | undefined {
  const guide = lspInstallGuideRegistry.get(serverId);
  return guide?.installCommand;
}

/**
 * Build chip + hover-card copy for the current language-service status.
 */
export function languageServicePresentation(
  status: FilesLanguageServiceStatus,
  t: FilesTranslate
): LanguageServicePresentation {
  switch (status.state) {
    case "disabled": {
      const { reason } = status;
      if (reason === "editor-disabled") {
        return {
          description: t(
            "filePanel.languageService.description.disabled.editorDisabled",
            "Language features are turned off for the files editor."
          ),
          label: t("filePanel.languageService.state.disabled", "Disabled"),
          nextStep: t(
            "filePanel.languageService.nextStep.openEditorLanguageSettings",
            "Open Settings → Files and enable editor language features."
          ),
          title: t(
            "filePanel.languageService.title.disabled.editorDisabled",
            "Editor language features are off"
          ),
          tone: "neutral",
        };
      }
      if (reason === "worktrees-disabled") {
        return {
          description: t(
            "filePanel.languageService.description.disabled.worktreesDisabled",
            "Language services are disabled for worktrees."
          ),
          label: t("filePanel.languageService.state.disabled", "Disabled"),
          nextStep: t(
            "filePanel.languageService.nextStep.openLspSettings",
            "Open Settings → Files and enable language services for worktrees."
          ),
          title: t(
            "filePanel.languageService.title.disabled.worktreesDisabled",
            "Worktree language services are off"
          ),
          tone: "neutral",
        };
      }
      return {
        description: t(
          "filePanel.languageService.description.disabled.globallyDisabled",
          "Language services are turned off."
        ),
        label: t("filePanel.languageService.state.disabled", "Disabled"),
        nextStep: t(
          "filePanel.languageService.nextStep.openLspSettings",
          "Open Settings → Files and turn on “Run language servers”."
        ),
        title: t(
          "filePanel.languageService.title.disabled.globallyDisabled",
          "Language services are off"
        ),
        tone: "neutral",
      };
    }
    case "unsupported": {
      const { reason } = status;
      if (reason === "non-disk") {
        return {
          description: t(
            "filePanel.languageService.description.unsupported.nonDisk",
            "Save this file to the workspace to use language features."
          ),
          label: t(
            "filePanel.languageService.state.unsupported",
            "Unsupported"
          ),
          nextStep: t(
            "filePanel.languageService.nextStep.saveToWorkspace",
            "Save the file into an open project folder."
          ),
          title: t(
            "filePanel.languageService.title.unsupported.nonDisk",
            "File is not on disk"
          ),
          tone: "neutral",
        };
      }
      if (reason === "unsupported-root") {
        return {
          description: t(
            "filePanel.languageService.description.unsupported.unsupportedRoot",
            "Open a supported local workspace to use language features."
          ),
          label: t(
            "filePanel.languageService.state.unsupported",
            "Unsupported"
          ),
          nextStep: t(
            "filePanel.languageService.nextStep.openLocalWorkspace",
            "Open a local project folder, then reopen this file."
          ),
          title: t(
            "filePanel.languageService.title.unsupported.unsupportedRoot",
            "Workspace is not supported"
          ),
          tone: "neutral",
        };
      }
      return {
        description: t(
          "filePanel.languageService.description.unsupported.noProvider",
          "Pier has no built-in language service for this file type."
        ),
        label: t("filePanel.languageService.state.unsupported", "Unsupported"),
        nextStep: t(
          "filePanel.languageService.nextStep.installLanguageTool",
          "Install a language server for this file type on your machine (PATH), or open another file type Pier supports."
        ),
        title: t(
          "filePanel.languageService.title.unsupported.noProvider",
          "No language service for this file type"
        ),
        tone: "neutral",
      };
    }
    case "starting":
      return {
        description: t(
          "filePanel.languageService.description.starting",
          "Language features are starting."
        ),
        label: t("filePanel.languageService.state.starting", "Starting"),
        title: t(
          "filePanel.languageService.title.starting",
          "Starting language service"
        ),
        tone: "info",
      };
    case "ready":
      return {
        description: t(
          "filePanel.languageService.description.ready",
          "Language features are ready."
        ),
        label: t("filePanel.languageService.state.ready", "Ready"),
        title: t(
          "filePanel.languageService.title.ready",
          "Language service ready"
        ),
        tone: "success",
      };
    case "retrying": {
      const retryBody: Record<
        (typeof status)["reason"],
        { description: string; title: string }
      > = {
        exited: {
          description: t(
            "filePanel.languageService.description.retrying.exited",
            "The language server exited. Pier will retry automatically."
          ),
          title: t(
            "filePanel.languageService.title.retrying.exited",
            "Language server stopped"
          ),
        },
        failed: {
          description: t(
            "filePanel.languageService.description.retrying.failed",
            "The language server failed. Pier will retry automatically."
          ),
          title: t(
            "filePanel.languageService.title.retrying.failed",
            "Language server error"
          ),
        },
        "initialize-failed": {
          description: t(
            "filePanel.languageService.description.retrying.initializeFailed",
            "The language server could not initialize. Pier will retry automatically."
          ),
          title: t(
            "filePanel.languageService.title.retrying.initializeFailed",
            "Language server failed to start"
          ),
        },
        "send-failed": {
          description: t(
            "filePanel.languageService.description.retrying.sendFailed",
            "Pier could not contact the language server. Pier will retry automatically."
          ),
          title: t(
            "filePanel.languageService.title.retrying.sendFailed",
            "Lost contact with language server"
          ),
        },
      };
      const body = retryBody[status.reason];
      return {
        description: body.description,
        label: t("filePanel.languageService.state.retrying", "Retrying"),
        nextStep: t(
          "filePanel.languageService.nextStep.waitOrRestart",
          "Wait for the retry, or restart Pier if it keeps failing."
        ),
        title: body.title,
        tone: "warning",
      };
    }
    case "paused": {
      if (status.reason === "workspace-evicted") {
        return {
          description: t(
            "filePanel.languageService.description.paused.workspaceEvicted",
            "This workspace was paused to free resources."
          ),
          label: t("filePanel.languageService.state.paused", "Paused"),
          nextStep: t(
            "filePanel.languageService.nextStep.focusEditor",
            "Click in the editor to resume language features."
          ),
          title: t(
            "filePanel.languageService.title.paused.workspaceEvicted",
            "Language service paused"
          ),
          tone: "neutral",
        };
      }
      return {
        description: t(
          "filePanel.languageService.description.paused.idleRelease",
          "Language features were released after idle time."
        ),
        label: t("filePanel.languageService.state.paused", "Paused"),
        nextStep: t(
          "filePanel.languageService.nextStep.focusEditor",
          "Click in the editor to resume language features."
        ),
        title: t(
          "filePanel.languageService.title.paused.idleRelease",
          "Language service idle"
        ),
        tone: "neutral",
      };
    }
    case "error": {
      return errorPresentation(status, t);
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function errorPresentation(
  status: Extract<FilesLanguageServiceStatus, { state: "error" }>,
  t: FilesTranslate
): LanguageServicePresentation {
  const { reason, serverId } = status;
  const language = serverDisplayName(serverId, t);
  const command = installCommandForServer(serverId);

  if (reason === "server-unavailable" || reason === "launch-failed") {
    return {
      ...(command ? { command } : {}),
      description: t(
        "filePanel.languageService.description.error.serverUnavailableDetail",
        "Pier could not find the language server for {{language}} on this computer. Completions and diagnostics need that program on your PATH.",
        { language }
      ),
      label: t("filePanel.languageService.state.notInstalled", "Not installed"),
      nextStep: command
        ? t(
            "filePanel.languageService.nextStep.installThenRestart",
            "Run the install command below in a terminal, then restart Pier."
          )
        : t(
            "filePanel.languageService.nextStep.installOfficialTools",
            "Install the language server for this file type (see Settings → Files → Language servers on this computer), then restart Pier."
          ),
      title: t(
        "filePanel.languageService.title.error.serverUnavailable",
        "Language server not found for {{language}}",
        { language }
      ),
      tone: "warning",
    };
  }

  if (reason === "limit-reached") {
    return {
      description: t(
        "filePanel.languageService.description.error.limitReached",
        "Too many workspaces already have language services open."
      ),
      label: t("filePanel.languageService.state.error", "Failed"),
      nextStep: t(
        "filePanel.languageService.nextStep.adjustLimit",
        "Close another project tab, or raise the language service limit under Settings → Files."
      ),
      title: t(
        "filePanel.languageService.title.error.limitReached",
        "Language service limit reached"
      ),
      tone: "danger",
    };
  }

  if (reason === "initialize-failed") {
    return {
      ...(command ? { command } : {}),
      description: t(
        "filePanel.languageService.description.error.initializeFailed",
        "The language server started but could not initialize for {{language}}.",
        { language }
      ),
      label: t("filePanel.languageService.state.error", "Failed"),
      nextStep: t(
        "filePanel.languageService.nextStep.reinstallOrRestart",
        "Restart Pier. If it keeps failing, reinstall the language server."
      ),
      title: t(
        "filePanel.languageService.title.error.initializeFailed",
        "Language server failed to initialize"
      ),
      tone: "danger",
    };
  }

  if (reason === "cleanup-failed") {
    return {
      description: t(
        "filePanel.languageService.description.error.cleanupFailed",
        "The language service process could not be closed."
      ),
      label: t("filePanel.languageService.state.error", "Failed"),
      nextStep: t(
        "filePanel.languageService.nextStep.restartApp",
        "Restart Pier, then open the file again."
      ),
      title: t(
        "filePanel.languageService.title.error.cleanupFailed",
        "Could not stop language service"
      ),
      tone: "danger",
    };
  }

  if (reason === "bridge-unavailable") {
    return {
      description: t(
        "filePanel.languageService.description.error.bridgeUnavailable",
        "Pier could not reach the language service host."
      ),
      label: t("filePanel.languageService.state.error", "Failed"),
      nextStep: t(
        "filePanel.languageService.nextStep.restartApp",
        "Restart Pier, then open the file again."
      ),
      title: t(
        "filePanel.languageService.title.error.bridgeUnavailable",
        "Language service unavailable"
      ),
      tone: "danger",
    };
  }

  return {
    ...(command ? { command } : {}),
    description: t(
      "filePanel.languageService.description.error.retryExhausted",
      "The language server stopped repeatedly for {{language}}.",
      { language }
    ),
    label: t("filePanel.languageService.state.error", "Failed"),
    nextStep: t(
      "filePanel.languageService.nextStep.restartAndCheckInstall",
      "Restart Pier. If the problem continues, reinstall the language server."
    ),
    title: t(
      "filePanel.languageService.title.error.retryExhausted",
      "Language server keeps failing"
    ),
    tone: "danger",
  };
}
