import type { PlannedPlan } from "../plan/types.ts";

/** Live progress while a multi-step install/update plan runs. */
export interface LifecycleStepProgress {
  /** Human label for the current step (e.g. "uv", "install script"). */
  label: string;
  /** 0–100 within the current step when the tool reports it. */
  percent?: number;
  stepCount: number;
  stepIndex: number;
}

export interface LifecycleRunOptions {
  env: NodeJS.ProcessEnv;
  /** Optional live progress (step + tool percent). */
  onProgress?: (progress: LifecycleStepProgress) => void;
  signal?: AbortSignal;
  /** Default 15 minutes. */
  timeoutMs?: number;
}

export interface LifecycleRunResult {
  cancelled?: boolean;
  code: number | null;
  ok: boolean;
  /** True when every failed step was a missing package manager (npm/brew/pipx/uv). */
  packageManagerMissing?: boolean;
  /** Sanitized stderr — progress bars stripped. */
  stderr: string;
  stdout: string;
  /** Index of the successful step, or last attempted. */
  stepIndex: number;
  timedOut?: boolean;
}

export interface LifecycleRunner {
  run(
    plan: PlannedPlan,
    options: LifecycleRunOptions
  ): Promise<LifecycleRunResult>;
}
