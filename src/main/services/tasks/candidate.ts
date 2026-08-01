import type {
  TaskCandidate,
  TaskCommandSpec,
  TaskConcurrencyPolicy,
  TaskInputRequest,
  TaskSource,
} from "@shared/contracts/tasks.ts";
import { asRecord, asStringArray, stableId } from "./utils.ts";

export function optionalEnv(
  value: unknown
): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function optionalTags(value: unknown): string[] | undefined {
  const tags = asStringArray(value);
  return tags.length > 0 ? tags : undefined;
}

export function taskCandidate(opts: {
  commandSpec: TaskCommandSpec;
  concurrencyPolicy?: TaskConcurrencyPolicy;
  cwd: string;
  dependsOn?: string[];
  dependsOrder?: "parallel" | "sequence";
  description?: string;
  env?: Record<string, string>;
  group?: string;
  hidden?: boolean;
  idParts: readonly string[];
  inputs?: TaskInputRequest[];
  label: string;
  presentation?: TaskCandidate["presentation"];
  source: TaskSource;
  tags?: string[];
  unsupportedReason?: string;
}): TaskCandidate {
  return {
    commandSpec: opts.commandSpec,
    concurrencyPolicy: opts.concurrencyPolicy ?? "dedupe",
    cwd: opts.cwd,
    id: stableId(opts.idParts),
    label: opts.label,
    source: opts.source,
    ...(opts.dependsOn && opts.dependsOn.length > 0
      ? { dependsOn: opts.dependsOn }
      : {}),
    ...(opts.dependsOrder ? { dependsOrder: opts.dependsOrder } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.group ? { group: opts.group } : {}),
    ...(opts.hidden ? { hidden: opts.hidden } : {}),
    ...(opts.inputs && opts.inputs.length > 0 ? { inputs: opts.inputs } : {}),
    ...(opts.presentation ? { presentation: opts.presentation } : {}),
    ...(opts.tags && opts.tags.length > 0 ? { tags: opts.tags } : {}),
    ...(opts.unsupportedReason
      ? { unsupportedReason: opts.unsupportedReason }
      : {}),
  };
}
