import type { Project } from "@shared/contracts/project.ts";
import { create } from "zustand";

interface ProjectState {
  /** projectId → Project 快照。 */
  byId: Record<string, Project>;
  replace: (projects: readonly Project[]) => void;
}

/**
 * Project registry 镜像——main store 快照的 renderer 副本。
 * 写入方: ProjectBridge (mount hydrate + onChanged 全量替换)。
 * 读取方: TerminalPanel（tab label 显 project name）、run-actions 列出 project。
 */
export const useProjectStore = create<ProjectState>((set) => ({
  byId: {},
  replace: (projects) => {
    set({ byId: Object.fromEntries(projects.map((p) => [p.id, p])) });
  },
}));

/** 按 id 查 project（未加载/未知 id 返回 undefined）。 */
export function useProjectById(id: string | undefined): Project | undefined {
  return useProjectStore((s) => (id ? s.byId[id] : undefined));
}
