/** 侧栏仅 5 叶：页内再细分，避免把小节抬成一级目录。 */
export type NavId =
  | "start"
  | "tasks"
  | "reference"
  | "agents"
  | "help";

export type NavLeaf = {
  id: NavId;
  label: string;
};

export const NAV_LEAVES: NavLeaf[] = [
  { id: "start", label: "开始" },
  { id: "tasks", label: "常用任务" },
  { id: "reference", label: "命令参考" },
  { id: "agents", label: "智能体" },
  { id: "help", label: "疑难" },
];

export const DEFAULT_NAV_ID: NavId = "start";

export function isNavId(value: string): value is NavId {
  return NAV_LEAVES.some((leaf) => leaf.id === value);
}

export function navLabel(id: NavId): string {
  return NAV_LEAVES.find((leaf) => leaf.id === id)?.label ?? id;
}
