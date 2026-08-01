import type { Translate } from "./shared.tsx";

const OPAQUE_STORE_CODES = new Set([
  "action-blocked",
  "operation-not-applied",
  "plan-stale",
  "revision-conflict",
  "content-conflict",
]);

export function skillsErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey:
    | "settings.skills.actionFailedBody"
    | "settings.skills.importFailedBody"
    | "settings.skills.loadFailedBody"
    | "settings.skills.createFailedBody"
    | "settings.skills.createContentSaveFailedBody"
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
  if (message.includes("skill-exists") || message.includes("already exists")) {
    return t("settings.skills.blankIdTaken");
  }
  if (message.includes("reserved") && message.includes("pier-")) {
    return t("settings.skills.blankIdReserved");
  }
  if (
    message.includes("must include string name") ||
    message.includes("must include string description") ||
    message.includes("must match directory id") ||
    message.includes("invalid-skill") ||
    message.includes("skill-md-invalid")
  ) {
    return t("settings.skills.createSkillMdInvalid");
  }
  const trimmed = message.trim();
  if (!trimmed || OPAQUE_STORE_CODES.has(trimmed)) {
    return t(fallbackKey);
  }
  return trimmed;
}
