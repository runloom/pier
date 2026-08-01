import type {
  AssetRootRef,
  RuleFileId,
  RuleFileState,
  RuleFileView,
} from "@shared/contracts/agent/assets.ts";
import { File, FileQuestion, FileWarning, Folder } from "lucide-react";
import type { useT } from "@/i18n/use-t.ts";

export const RULES_MAX_BYTES = 512 * 1024;

export function assetRootFor(
  projectRootPath: string,
  isPierHome: boolean
): AssetRootRef {
  return isPierHome ? { scope: "home" } : { scope: "project", projectRootPath };
}

export function ruleFamilyLabel(
  id: RuleFileId,
  t: ReturnType<typeof useT>
): string {
  switch (id) {
    case "agents-md":
      return t("settings.projects.rulesFamilyAgents");
    case "claude-md":
      return t("settings.projects.rulesFamilyClaude");
    case "gemini-md":
      return t("settings.projects.rulesFamilyGemini");
    case "cursor-rules":
      return t("settings.projects.rulesFamilyCursor");
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function isOversizeFile(file: RuleFileView): boolean {
  return (
    file.state === "file" &&
    typeof file.sizeBytes === "number" &&
    file.sizeBytes > RULES_MAX_BYTES
  );
}

export function ruleStateBadge(
  file: RuleFileView,
  t: ReturnType<typeof useT>
): {
  label: string;
  variant: "success" | "warning" | "outline" | "neutral" | "destructive";
} {
  if (file.state === "file") {
    if (isOversizeFile(file)) {
      return {
        label: t("settings.projects.rulesStateTruncated"),
        variant: "warning",
      };
    }
    return {
      label: t("settings.projects.rulesStateFile"),
      variant: "success",
    };
  }
  if (file.state === "directory") {
    return {
      label: t("settings.projects.rulesStateDirectory"),
      variant: "outline",
    };
  }
  if (file.state === "missing") {
    return {
      label: t("settings.projects.rulesStateMissing"),
      variant: "warning",
    };
  }
  return {
    label: t("settings.projects.rulesStateOther"),
    variant: "neutral",
  };
}

export function RuleFileIcon({ state }: { state: RuleFileState }) {
  if (state === "directory") return <Folder />;
  if (state === "missing") return <FileQuestion />;
  if (state === "other") return <FileWarning />;
  return <File />;
}
