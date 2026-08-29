import type { GitCommitPushAction } from "./paths.ts";

/** null = this dialog session has not toggled; follow situational / setting default. */
export type CommitCheckboxIntent = boolean | null;

export function includeUnstagedChecked(
  unstagedCount: number,
  intent: CommitCheckboxIntent
): boolean {
  if (unstagedCount === 0) {
    return false;
  }
  return intent ?? true;
}

export function pushAfterChecked(
  action: GitCommitPushAction | null,
  settingOn: boolean,
  intent: CommitCheckboxIntent
): boolean {
  if (action === null) {
    return false;
  }
  return intent ?? settingOn;
}

export function isModEnterSubmit(event: {
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
}): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey);
}
