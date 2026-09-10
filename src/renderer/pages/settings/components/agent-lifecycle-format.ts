import { sanitizeProcessOutput } from "@shared/agent-lifecycle/process-output.ts";
import { isAgentUpdateAvailable } from "@shared/agent-lifecycle/version-compare.ts";
import type {
  AgentLifecycleAction,
  AgentLifecycleProgress,
} from "@shared/contracts/agent/lifecycle.ts";
import type { TFunction } from "i18next";

const KNOWN_ERROR_CODES = new Set([
  "unsupported",
  "unavailable",
  "no_command",
  "command_failed",
  "version_unchanged",
  "not_runnable",
  "not_found_after_install",
  "already_installed",
  "busy",
  "cancelled",
  "timeout",
  "env_unavailable",
  "package_manager_missing",
  "node_requirement_unmet",
  /** Uninstall PM exited 0 but post-probe still detects the agent. */
  "still_detected",
]);

/** Soft outcomes — toast only, not a red row failure. */
export function isLifecycleSoftFailure(result: {
  softFailure?: string | undefined;
  errorCode?: string | undefined;
}): boolean {
  return (
    result.softFailure === "version_unchanged" ||
    result.softFailure === "not_runnable" ||
    result.errorCode === "version_unchanged" ||
    result.errorCode === "not_runnable" ||
    result.errorCode === "cancelled" ||
    result.errorCode === "busy"
  );
}

function cleanErrorDetail(rawDetail: string): string {
  return sanitizeProcessOutput(rawDetail);
}

/** Codes whose alert may include sanitized stderr / command preview. */
const DETAIL_CODES = new Set([
  "command_failed",
  "env_unavailable",
  "not_found_after_install",
  "package_manager_missing",
  "still_detected",
]);

interface LifecycleErrorInput {
  commandPreview?: string | undefined;
  errorCode?: string | undefined;
  errorDetail?: string | undefined;
  hostNode?: { path: string; version: string } | null | undefined;
  installPaths?: readonly string[] | undefined;
  requiredNode?: string | undefined;
}

function formatInstallPathsFact(
  t: TFunction,
  installPaths: readonly string[]
): string {
  return t("settings.agents.lifecycle.facts.installs", {
    count: installPaths.length,
    paths: installPaths.join("\n"),
  });
}

function formatHostNodeFact(
  t: TFunction,
  hostNode: { path: string; version: string }
): string {
  return t("settings.agents.lifecycle.facts.node", {
    path: hostNode.path,
    version: hostNode.version,
  });
}

export function formatLifecycleErrorMessage(
  t: TFunction,
  result: LifecycleErrorInput
): string {
  const code = result.errorCode;
  const key =
    code && KNOWN_ERROR_CODES.has(code)
      ? `settings.agents.lifecycle.errors.${code}`
      : "settings.agents.lifecycle.errors.command_failed";
  const params = {
    ...(result.requiredNode ? { required: result.requiredNode } : {}),
    ...(result.hostNode ? { current: result.hostNode.version } : {}),
  };
  return Object.keys(params).length > 0 ? t(key, params) : t(key);
}

export function formatLifecycleError(
  t: TFunction,
  result: LifecycleErrorInput,
  options?: { appendHostNodeFact?: boolean; includeMessage?: boolean }
): string {
  const message = formatLifecycleErrorMessage(t, result);
  const code = result.errorCode;
  if (code === "timeout" || code === "cancelled") {
    return message;
  }
  const lines: string[] = [];
  if (options?.includeMessage !== false) {
    lines.push(message);
  }
  if (!code || DETAIL_CODES.has(code)) {
    const cleaned = cleanErrorDetail(result.errorDetail?.trim() ?? "");
    const detail = cleaned || result.commandPreview?.trim() || "";
    if (detail) {
      lines.push(detail);
    }
  }
  if (options?.appendHostNodeFact !== false && result.hostNode) {
    lines.push(formatHostNodeFact(t, result.hostNode));
  }
  if (result.installPaths && result.installPaths.length > 0) {
    lines.push(formatInstallPathsFact(t, result.installPaths));
  }
  return lines.join("\n\n");
}

export function formatLifecycleBatchFailureLine(
  t: TFunction,
  options: LifecycleErrorInput & { agentLabel: string }
): string {
  return `${options.agentLabel}: ${formatLifecycleError(t, options)}`;
}

/** Batch alert: one block per agent; host Node fact once at the bottom. */
export function formatLifecycleBatchFailureBody(
  t: TFunction,
  failures: ReadonlyArray<LifecycleErrorInput & { agentLabel: string }>
): string {
  const blocks = failures.map(
    (failure) =>
      `${failure.agentLabel}: ${formatLifecycleError(t, failure, {
        appendHostNodeFact: false,
      })}`
  );
  const hostNode = failures.find((failure) => failure.hostNode)?.hostNode;
  if (hostNode) {
    blocks.push(formatHostNodeFact(t, hostNode));
  }
  return blocks.join("\n\n");
}

/**
 * Busy label for the in-flight / queued action button.
 * Product copy only — never package-manager names (npm/uv/…).
 *
 * - base: 安装中 / 更新中 / 排队中
 * - step N/M: only when stepCount > 1 (multi-channel fallback)
 * - percent: only when tool actually reported a finite 0–100 value
 */
export function lifecycleBusyStatusText(
  t: TFunction,
  options: {
    action: AgentLifecycleAction | undefined;
    /** True when this agent is in a batch but not yet claimed by a worker. */
    queued?: boolean;
    progress: AgentLifecycleProgress | undefined;
    /** Force-reinstall row — same main action, different product copy. */
    reinstall?: boolean;
  }
): string {
  const { action, queued, progress } = options;
  if (queued) {
    return t("settings.agents.action.queueBusy");
  }

  let base = t("settings.agents.action.updateBusy");
  if (action === "install") {
    base = t("settings.agents.action.installBusy");
  } else if (action === "uninstall") {
    base = t("settings.agents.action.uninstallBusy");
  } else if (action === "update" && options.reinstall === true) {
    base = t("settings.agents.action.reinstallBusy");
  }

  const stepCount = progress?.stepCount;
  const stepIndex = progress?.stepIndex;
  const showStep =
    typeof stepCount === "number" &&
    stepCount > 1 &&
    typeof stepIndex === "number" &&
    stepIndex >= 0 &&
    stepIndex < stepCount;

  const raw = progress?.percent;
  const showPercent =
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 100;

  const parts = [base];
  if (showStep) {
    parts.push(
      t("settings.agents.action.busyStep", {
        current: stepIndex + 1,
        total: stepCount,
      })
    );
  }
  if (showPercent) {
    parts.push(
      t("settings.agents.action.busyPercent", { percent: Math.round(raw) })
    );
  }
  return parts.join(" ");
}

/**
 * Compact version meta for the list row.
 * - Semantically older current + newer latest → `1.2.3 → 1.2.4`
 * - Same or only one → single version (no redundant "latest: same")
 */
export function formatAgentVersionMeta(
  version: string | null | undefined,
  latestVersion: string | null | undefined
): string | null {
  const current = version?.trim() ?? "";
  const latest = latestVersion?.trim() ?? "";
  if (current.length > 0 && latest.length > 0) {
    // Semantic compare: avoid false "a → b" when tokens equal after normalize.
    if (isAgentUpdateAvailable(current, latest)) {
      return `${current} → ${latest}`;
    }
    return current;
  }
  if (current.length > 0) {
    return current;
  }
  if (latest.length > 0) {
    return latest;
  }
  return null;
}

export interface AgentLifecycleFailure {
  action: AgentLifecycleAction;
  errorCode?: string | undefined;
  errorDetail?: string | undefined;
  /** Last plan step when known (e.g. npm). */
  stepLabel?: string | undefined;
}

/** Short red-line copy on the row (name is already in the title). */
export function formatLifecycleRowFailure(
  t: TFunction,
  options: {
    name: string;
    failure: AgentLifecycleFailure;
    reinstall?: boolean;
  }
): string {
  const { failure } = options;
  if (failure.action === "install") {
    return t("settings.agents.action.rowInstallFailed");
  }
  if (failure.action === "uninstall") {
    if (failure.errorCode === "still_detected") {
      return t("settings.agents.action.rowUninstallPartial");
    }
    return t("settings.agents.action.rowUninstallFailed");
  }
  if (options.reinstall === true) {
    return t("settings.agents.action.rowReinstallFailed");
  }
  return t("settings.agents.action.rowUpdateFailed");
}

export interface AgentRowStatusBadge {
  label: string;
  variant: "secondary" | "outline";
}

/**
 * Exception badges only (priority: broken > conflict > missing > disabled).
 * Healthy install and "update available" stay silent — version arrow + Update
 * button carry that. Missing stays on the row even when Install is shown.
 * Missing beats disabled so stale prefs for uninstalled agents don't say
 * "Disabled".
 */
export function resolveAgentStatusBadge(
  t: TFunction,
  state: {
    broken?: boolean;
    conflict?: boolean;
    disabled: boolean;
    detected: boolean;
  }
): AgentRowStatusBadge | null {
  if (state.broken) {
    return {
      label: t("settings.agents.status.broken"),
      variant: "outline",
    };
  }
  if (state.conflict) {
    return {
      label: t("settings.agents.status.conflict"),
      variant: "outline",
    };
  }
  if (!state.detected) {
    return {
      label: t("settings.agents.status.missing"),
      variant: "outline",
    };
  }
  if (state.disabled) {
    return {
      label: t("settings.agents.status.disabled"),
      variant: "outline",
    };
  }
  return null;
}

/**
 * Offer one-click install as soon as PATH detect says missing.
 * Do not wait for the lifecycle probe; hide when the host (or catalog) says
 * this agent has no managed install.
 */
export function shouldOfferAgentInstall(state: {
  canInstall?: boolean;
  hasDetected: boolean;
  installedButBroken?: boolean;
  isBusy: boolean;
  isDetected: boolean;
  oneClickInstall: boolean;
}): boolean {
  if (!state.hasDetected || state.isDetected || state.isBusy) {
    return false;
  }
  if (state.installedButBroken === true) {
    return false;
  }
  if (state.canInstall === false) {
    return false;
  }
  if (state.canInstall === true) {
    return true;
  }
  return state.oneClickInstall;
}
