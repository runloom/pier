import type { Translate } from "./skills-shared.tsx";

export function skillsErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey:
    | "settings.skills.actionFailedBody"
    | "settings.skills.importFailedBody"
    | "settings.skills.loadFailedBody"
): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    message.includes("revision-conflict") ||
    message.includes("plan-stale") ||
    message.includes("content-conflict")
  ) {
    return t("settings.skills.conflictReloadBody");
  }
  if (
    message.includes("project-identity-changed") ||
    message.includes("identity-mismatch")
  ) {
    return t("settings.skills.identityChangedBody");
  }
  if (
    message.includes("staging candidate") ||
    message.includes("candidate expired") ||
    message.includes("candidate missing")
  ) {
    return t("settings.skills.candidateExpiredBody");
  }
  return t(fallbackKey);
}
