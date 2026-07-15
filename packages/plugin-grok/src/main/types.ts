export interface AccountUsageResult {
  error?: string;
  status: "error" | "ok";
  windows: Array<{
    id: string;
    limitId: string;
    limitName?: string;
    resetsAt?: number;
    usedPercent: number;
    windowMinutes?: number;
  }>;
}
