import type { TaskBoardParams } from "../shared/types.ts";

export function encodeScopeId(params: TaskBoardParams): string {
  const parts = [`repo=${params.repo}`];
  if (params.provider) {
    parts.push(`provider=${params.provider}`);
  }
  if (params.projectId) {
    parts.push(`projectId=${params.projectId}`);
  }
  if (params.milestone) {
    parts.push(`milestone=${params.milestone}`);
  }
  if (params.label) {
    parts.push(`label=${params.label}`);
  }
  return parts.join("&");
}

export function boardParamsMatch(
  left: TaskBoardParams | undefined,
  right: TaskBoardParams
): boolean {
  if (!left) {
    return false;
  }
  return encodeScopeId(left) === encodeScopeId(right);
}
