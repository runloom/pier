import type {
  PierBindingsConvergeResult,
  PierBoundSkillView,
  PierHomeSkillDelivery,
  PierHomeSkillsSnapshot,
  PierHomeSkillView,
} from "@shared/contracts/pier-home.ts";
import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierHomeSkillsAPI {
  create(args: {
    skillId: string;
    description?: string;
    alwaysInclude?: boolean;
    delivery?: PierHomeSkillDelivery;
  }): Promise<PierHomeSkillView>;
  delete(skillId: string): Promise<PierBindingsConvergeResult>;
  list(): Promise<PierHomeSkillView[]>;
  read(
    args:
      | { skillId: string }
      | { systemSkillId: string }
      | { root: string; directoryName: string }
      | { absolutePath: string }
  ): Promise<string>;
  reveal(args: { skillId?: string; absolutePath?: string }): Promise<void>;
  setAlwaysInclude(
    skillId: string,
    alwaysInclude: boolean,
    delivery?: PierHomeSkillDelivery
  ): Promise<{
    converge: PierBindingsConvergeResult;
    skill: PierHomeSkillView;
  }>;
  snapshot(): Promise<PierHomeSkillsSnapshot>;
  write(
    skillId: string,
    skillMd: string
  ): Promise<{
    converge: PierBindingsConvergeResult;
    skill: PierHomeSkillView;
  }>;
}

export interface PierPierBindingsAPI {
  bind(
    projectRef: ProjectRootRef,
    skillId: string,
    delivery?: PierHomeSkillDelivery
  ): Promise<PierBoundSkillView[]>;
  list(projectRef: ProjectRootRef): Promise<PierBoundSkillView[]>;
  unbind(
    projectRef: ProjectRootRef,
    skillId: string
  ): Promise<PierBoundSkillView[]>;
}

const emptyConverge = (): PierBindingsConvergeResult => ({
  converged: [],
  failed: [],
});

export const pierHomeSkillsApi: PierHomeSkillsAPI = {
  create: async (args) => {
    const result = await invokePierCommand<{ skill: PierHomeSkillView }>({
      type: "pierHome.skills.create",
      skillId: args.skillId,
      ...(args.description === undefined
        ? {}
        : { description: args.description }),
      ...(args.alwaysInclude === undefined
        ? {}
        : { alwaysInclude: args.alwaysInclude }),
      ...(args.delivery === undefined ? {} : { delivery: args.delivery }),
    });
    return result.skill;
  },
  delete: async (skillId) => {
    const result = await invokePierCommand<{
      converge?: PierBindingsConvergeResult;
    }>({
      skillId,
      type: "pierHome.skills.delete",
    });
    return result.converge ?? emptyConverge();
  },
  list: async () => {
    const result = await invokePierCommand<{ skills: PierHomeSkillView[] }>({
      type: "pierHome.skills.list",
    });
    return result.skills;
  },
  read: async (args) => {
    let readArgs:
      | { skillId: string }
      | { systemSkillId: string }
      | { root: string; directoryName: string }
      | { absolutePath: string };
    if ("skillId" in args) {
      readArgs = { skillId: args.skillId };
    } else if ("systemSkillId" in args) {
      readArgs = { systemSkillId: args.systemSkillId };
    } else if ("root" in args) {
      readArgs = { root: args.root, directoryName: args.directoryName };
    } else {
      readArgs = { absolutePath: args.absolutePath };
    }
    const result = await invokePierCommand<{ skillMd: string }>({
      type: "pierHome.skills.read",
      ...readArgs,
    });
    return result.skillMd;
  },
  reveal: async (args) => {
    await invokePierCommand({
      type: "pierHome.skills.reveal",
      ...(args.skillId === undefined ? {} : { skillId: args.skillId }),
      ...(args.absolutePath === undefined
        ? {}
        : { absolutePath: args.absolutePath }),
    });
  },
  setAlwaysInclude: async (skillId, alwaysInclude, delivery) => {
    const result = await invokePierCommand<{
      converge?: PierBindingsConvergeResult;
      skill: PierHomeSkillView;
    }>({
      type: "pierHome.skills.setAlwaysInclude",
      skillId,
      alwaysInclude,
      ...(delivery === undefined ? {} : { delivery }),
    });
    return {
      skill: result.skill,
      converge: result.converge ?? emptyConverge(),
    };
  },
  snapshot: () =>
    invokePierCommand<PierHomeSkillsSnapshot>({
      type: "pierHome.skills.snapshot",
    }),
  write: async (skillId, skillMd) => {
    const result = await invokePierCommand<{
      converge?: PierBindingsConvergeResult;
      skill: PierHomeSkillView;
    }>({
      skillId,
      skillMd,
      type: "pierHome.skills.write",
    });
    return {
      skill: result.skill,
      converge: result.converge ?? emptyConverge(),
    };
  },
};

export const pierBindingsApi: PierPierBindingsAPI = {
  bind: async (projectRef, skillId, delivery) => {
    const result = await invokePierCommand<{ skills: PierBoundSkillView[] }>({
      projectRef,
      skillId,
      type: "skills.pierBindings.bind",
      ...(delivery === undefined ? {} : { delivery }),
    });
    return result.skills;
  },
  list: async (projectRef) => {
    const result = await invokePierCommand<{ skills: PierBoundSkillView[] }>({
      projectRef,
      type: "skills.pierBindings.list",
    });
    return result.skills;
  },
  unbind: async (projectRef, skillId) => {
    const result = await invokePierCommand<{ skills: PierBoundSkillView[] }>({
      projectRef,
      skillId,
      type: "skills.pierBindings.unbind",
    });
    return result.skills;
  },
};
