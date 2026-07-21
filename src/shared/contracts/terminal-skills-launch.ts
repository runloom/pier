/** 启动门阻断的结构化载荷（design v8 §5.2 / §7.8）。 */
export interface SkillsLaunchBlockedInfo {
  degradePolicySummary: "allowed" | "denied";
  expiresAt: number;
  focusIssueIds?: string[] | undefined;
  issueSummary: string[];
  issues?:
    | Array<{
        adapterKind?: string | undefined;
        code: string;
        id: string;
        relativeTarget?: string | undefined;
        skillId?: string | undefined;
      }>
    | undefined;
  launchAttemptId: string;
  projectRootPath?: string | undefined;
}

export type SkillsLaunchContinueResult =
  | {
      status: "ready";
      launchAttemptId: string;
      degraded: boolean;
    }
  | {
      status: "cancelled";
      launchAttemptId: string;
      decision: "open-settings" | "cancel";
    }
  | {
      status: "rejected";
      launchAttemptId: string;
      reason: string;
      message: string;
      gate?: ({ status: "blocked" } & SkillsLaunchBlockedInfo) | undefined;
    }
  | {
      status: "indeterminate";
      launchAttemptId: string;
      message: string;
    };
