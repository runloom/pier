import { homedir } from "node:os";
import { join } from "node:path";
import type { LocalEnvironmentState } from "@shared/contracts/environment.ts";
import type { ProjectSkillsInvalidatedEvent } from "@shared/contracts/project-skills.ts";
import { installMemoryLauncher } from "../services/agent-managed-assets/launcher-install.ts";
import {
  createNpxMemoryPrewarmRunner,
  prewarmMemoryEngine,
} from "../services/agent-managed-assets/prewarm.ts";
import { MemoryReconciler } from "../services/agent-managed-assets/reconcile.ts";
import {
  convergeMemoryRegistry,
  memoryRegistryStatusRows,
} from "../services/agent-managed-assets/registry.ts";
import { migrateLegacyMemoryBaseDir } from "../services/agent-managed-assets/store.ts";
import { createAgentMcpCatalogService } from "../services/agent-mcp-catalog/service.ts";
import { createAgentRulesService } from "../services/agent-rules/service.ts";
import type { FilePathTransactionLock } from "../services/files/path-transaction-lock.ts";
import {
  createLocalEnvironmentService,
  type LocalEnvironmentService,
} from "../services/local-environments-service.ts";
import type { PanelContextService } from "../services/panel-context-service.ts";
import {
  createPierHomeService,
  type PierHomeService,
} from "../services/pier-home/service.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import {
  migrateLegacySystemSkillsCacheRoot,
  setSystemSkillsCacheRootForHost,
} from "../services/project-skills/system-skills/cache-root.ts";
import { wireProjectSkills } from "./project-skills-wiring.ts";
import { broadcastEnvironmentsChanged } from "./window-broadcasts.ts";

export function wireAppCorePierHomeAndSkills(input: {
  appVersion: string;
  isProduction: boolean;
  listInstalledAgents: () => Promise<string[]>;
  onProjectSkillsInvalidated: (
    event: Omit<ProjectSkillsInvalidatedEvent, "type">
  ) => void;
  panelContexts: PanelContextService;
  processEnvironment: ProcessEnvironmentService;
  /** Electron resources root (`…/resources` in dev, `process.resourcesPath` in prod). */
  resourcesRoot: string;
  transactionLock: FilePathTransactionLock;
  userDataPath: string;
}): {
  agentLaunchGate: ReturnType<typeof wireProjectSkills>["agentLaunchGate"];
  agentMcpCatalog: ReturnType<typeof createAgentMcpCatalogService>;
  agentRules: ReturnType<typeof createAgentRulesService>;
  localEnvironments: LocalEnvironmentService;
  /** 环境变更处理(广播;v3 记忆无需逐项目扫描)。 */
  onEnvironmentsChanged: (state: LocalEnvironmentState) => void;
  pierBindings: ReturnType<typeof wireProjectSkills>["pierBindings"];
  pierHome: PierHomeService;
  projectMemory: MemoryReconciler;
  projectSkills: ReturnType<typeof wireProjectSkills>["projectSkills"];
  systemSkills: ReturnType<typeof wireProjectSkills>["systemSkills"];
} {
  let pierHomeRef: PierHomeService | null = null;
  const localEnvironments = createLocalEnvironmentService({
    processEnvironment: input.processEnvironment,
    isPierHomeRoot: (path) =>
      pierHomeRef?.isHomeRoot(path) ?? Promise.resolve(false),
  });
  const pierHome = createPierHomeService({
    userDataPath: input.userDataPath,
    onEnsured: async (info) => {
      await localEnvironments.upsertPierHome(info.rootPath);
    },
  });
  pierHomeRef = pierHome;
  const agentRules = createAgentRulesService({
    localEnvironments,
    pierHome,
  });
  const agentMcpCatalog = createAgentMcpCatalogService({
    localEnvironments,
    pierHome,
    listInstalledAgents: input.listInstalledAgents,
  });
  pierHome
    .ensure()
    .then(async () => {
      broadcastEnvironmentsChanged(await localEnvironments.snapshot());
    })
    .catch((err: unknown) => {
      console.error("[pier-home] ensure failed:", err);
    });
  // 系统技能缓存被项目内软链以绝对路径引用,必须跨 build 稳定 → ~/.pier;
  // 存量从 userData 一次性搬迁(项目内旧软链由技能收敛按 owned 判定自愈)。
  const systemSkillsRoot = join(homedir(), ".pier", "system-skills");
  try {
    migrateLegacySystemSkillsCacheRoot(
      join(input.userDataPath, "skills", ".system"),
      systemSkillsRoot
    );
  } catch (err: unknown) {
    console.error("[system-skills] cache root migration failed:", err);
  }
  setSystemSkillsCacheRootForHost(systemSkillsRoot);

  const { projectSkills, agentLaunchGate, pierBindings, systemSkills } =
    wireProjectSkills({
      userData: input.userDataPath,
      isProduction: input.isProduction,
      appVersion: input.appVersion,
      resourcesRoot: input.resourcesRoot,
      transactionLock: input.transactionLock,
      panelContexts: input.panelContexts,
      localEnvironments,
      pierHome,
      isPierHomeRoot: (path) => pierHome.isHomeRoot(path),
      listInstalledAgents: input.listInstalledAgents,
      onInvalidated: (event) => {
        input.onProjectSkillsInvalidated(event);
      },
    });

  // 记忆是外部智能体进程消费的机器级资产,放 ~/.pier(跨 build 稳定);
  // 存量从 userData 一次性搬迁。
  const memoryBaseDir = join(homedir(), ".pier", "memory");
  try {
    migrateLegacyMemoryBaseDir(
      join(input.userDataPath, "plugin-data", "pier.memory"),
      memoryBaseDir
    );
  } catch (err: unknown) {
    console.error("[memory] base dir migration failed:", err);
  }

  const prewarmEngine = () => {
    prewarmMemoryEngine(
      createNpxMemoryPrewarmRunner({
        resolveEnv: async () =>
          (await input.processEnvironment.resolve({ source: "task" })).env,
      })
    ).catch(() => undefined);
  };

  // v3:安装启动器 → 全局注册收敛(含 v2 项目条目迁移与确认门残留清理,
  // 迁移与全局写入均经 FilePathTransactionLock 与用户开关/其它写入方互斥)
  // → 预热引擎缓存。项目仓库零写入;交付面见 2026-08-27 v3 spec。
  const convergeRegistry = async (): Promise<void> => {
    const { currentPath } = await installMemoryLauncher({
      resourcesRoot: input.resourcesRoot,
    });
    await convergeMemoryRegistry({
      installedAgents: await input.listInstalledAgents(),
      launcherPath: currentPath,
      lock: input.transactionLock,
    });
  };
  convergeRegistry()
    .then(prewarmEngine)
    .catch((err: unknown) => {
      console.error("[memory] global registration failed:", err);
    });

  const projectMemory = new MemoryReconciler({
    agentRules,
    baseDir: memoryBaseDir,
    getProjectKind: (projectRootPath) =>
      localEnvironments.getProjectKind(projectRootPath),
    lock: input.transactionLock,
    onEnabled: () => {
      // 显式开启 = 用户可见的「修复动作」:重跑全局收敛(幂等)修复漂移/新装
      // 智能体缺口,再预热。
      convergeRegistry()
        .then(prewarmEngine)
        .catch((err: unknown) => {
          console.error("[memory] registry reconverge failed:", err);
        });
    },
    registryStatus: async () =>
      memoryRegistryStatusRows({
        installedAgents: await input.listInstalledAgents(),
      }),
  });

  return {
    agentLaunchGate,
    agentMcpCatalog,
    agentRules,
    localEnvironments,
    onEnvironmentsChanged: (state) => {
      broadcastEnvironmentsChanged(state);
    },
    pierBindings,
    pierHome,
    projectMemory,
    projectSkills,
    systemSkills,
  };
}
