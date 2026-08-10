export type PhaseSlice = {
  id: string;
  title: string;
};

export type PhaseStatus = "planned" | "in_progress" | "done";

export type ClosedLoopPhase = {
  wave: number;
  name: string;
  outcome: string;
  /** 实施状态：文档/代码交付进度，不是多智能体任务状态。 */
  status: PhaseStatus;
  slices: PhaseSlice[];
};

const PHASE_STATUSES = new Set<PhaseStatus>(["planned", "in_progress", "done"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(record: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

export function parseClosedLoopPhase(input: unknown): ClosedLoopPhase {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["wave", "name", "outcome", "status", "slices"])
  ) {
    throw new Error("阶段必须严格使用 wave、name、outcome、status 与 slices");
  }
  if (!(Number.isSafeInteger(input.wave) && Number(input.wave) >= 0)) {
    throw new Error("phase.wave 必须是非负整数");
  }
  if (!isNonEmptyString(input.name) || !isNonEmptyString(input.outcome)) {
    throw new Error("phase.name 与 phase.outcome 必须是非空字符串");
  }
  if (!isNonEmptyString(input.status) || !PHASE_STATUSES.has(input.status as PhaseStatus)) {
    throw new Error("phase.status 必须是 planned | in_progress | done");
  }
  if (!Array.isArray(input.slices) || input.slices.length === 0) {
    throw new Error("phase.slices 必须是非空数组");
  }

  const slices = input.slices.map((slice, index) => {
    if (
      !isRecord(slice) ||
      !hasOnlyKeys(slice, ["id", "title"]) ||
      !isNonEmptyString(slice.id) ||
      !isNonEmptyString(slice.title)
    ) {
      throw new Error(`phase.slices[${index}] 必须只包含非空 id 与 title`);
    }
    return { id: slice.id, title: slice.title };
  });

  return {
    wave: Number(input.wave),
    name: input.name,
    outcome: input.outcome,
    status: input.status as PhaseStatus,
    slices,
  };
}

export function parseClosedLoopPhases(input: unknown): ClosedLoopPhase[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("data.phases 必须是非空数组");
  }
  return input.map(parseClosedLoopPhase);
}
