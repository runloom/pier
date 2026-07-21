import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { dialog } from "electron";
import type { FilePathTransactionLock } from "../services/file-path-transaction-lock.ts";
import type { LocalEnvironmentService } from "../services/local-environments-service.ts";
import type { PanelContextService } from "../services/panel-context-service.ts";
import {
  createManagedAgentLaunchGate,
  type ManagedAgentLaunchGate,
} from "../services/project-skills/launch-gate.ts";
import {
  createProjectSkillsService,
  type ProjectSkillsService,
} from "../services/project-skills/service.ts";
import {
  createSystemSkillsChannel,
  type SystemSkillsChannel,
} from "../services/project-skills/system-skills.ts";

const execFileAsync = promisify(execFile);

/**
 * Git five-state inspection for projection targets (design v8 §3.6):
 * absent / ignored / untracked / tracked / unknown. Read-only `git` calls;
 * any failure degrades to "unknown" (plan then requires confirmation).
 */
async function inspectGitState(
  relativeTarget: string,
  projectRoot: string
): Promise<"absent" | "ignored" | "untracked" | "tracked" | "unknown"> {
  const absolute = join(projectRoot, ...relativeTarget.split("/"));
  try {
    await lstat(absolute);
  } catch {
    return "absent";
  }
  try {
    await execFileAsync(
      "git",
      ["-C", projectRoot, "ls-files", "--error-unmatch", "--", relativeTarget],
      { timeout: 5000 }
    );
    return "tracked";
  } catch {
    // Not tracked — distinguish ignored vs untracked below.
  }
  try {
    await execFileAsync(
      "git",
      ["-C", projectRoot, "check-ignore", "--quiet", "--", relativeTarget],
      { timeout: 5000 }
    );
    return "ignored";
  } catch (error) {
    const exitCode = (error as { code?: number | string }).code;
    // check-ignore exits 1 when the path is NOT ignored (i.e. untracked);
    // anything else (128 = not a repo, ENOENT = no git) is unknown.
    if (exitCode === 1) {
      return "untracked";
    }
    return "unknown";
  }
}

/**
 * Project skills wiring (design v8), split from app-core.ts (file-size cap):
 * system skills channel + skills service (shared project index from recent
 * panel contexts + local environments) + the managed agent launch gate.
 */
export function wireProjectSkills(args: {
  userData: string;
  isProduction: boolean;
  transactionLock: FilePathTransactionLock;
  panelContexts: PanelContextService;
  localEnvironments: LocalEnvironmentService;
  listInstalledAgents: () => Promise<readonly string[]>;
  onInvalidated: (event: {
    projectIdentity: string;
    observedRevision: string;
  }) => void;
}): {
  projectSkills: ProjectSkillsService;
  agentLaunchGate: ManagedAgentLaunchGate;
  systemSkills: SystemSkillsChannel;
} {
  const systemSkills = createSystemSkillsChannel({
    userData: args.userData,
    isProduction: args.isProduction,
    // First contribution consumer: official capability plugins (e.g. the
    // canvas skill) register here via the managed-plugin discipline chain.
    contributions: [],
  });

  const projectSkills = createProjectSkillsService({
    userData: args.userData,
    transactionLock: args.transactionLock,
    sharedLockRoot: join(homedir(), ".pier", "project-skills-locks"),
    // Local folder import source picker (design v8 §7.5) — production wiring.
    showOpenDialog: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
      });
      return { canceled: result.canceled, filePaths: result.filePaths };
    },
    // Git five-state for projection targets — deletion confirmations show
    // the real tracked/untracked/ignored fact instead of "unknown".
    inspectGitState,
    // Design v8 §3.3: shared local project index + recent panel contexts,
    // current-panel projects first. The index is an entry list, never an
    // authorization — every command re-resolves identity from realpath.
    listKnownProjectRoots: async () => {
      const roots: Array<{
        realPath: string;
        source: "panel" | "environment" | "unknown";
      }> = [];
      try {
        const recent = await args.panelContexts.listRecent();
        for (const context of recent) {
          if (context.projectRootPath) {
            roots.push({ realPath: context.projectRootPath, source: "panel" });
          }
        }
      } catch {
        // Panel context state unavailable — index still serves entries.
      }
      const snapshot = await args.localEnvironments.snapshot();
      for (const project of snapshot.projects) {
        roots.push({
          realPath: project.projectRootPath,
          source: "environment" as const,
        });
      }
      return roots;
    },
    listInstalledAgents: args.listInstalledAgents,
    systemSkills,
    onInvalidated: args.onInvalidated,
  });

  const agentLaunchGate = createManagedAgentLaunchGate({
    userData: args.userData,
    ensureReady: (skillArgs) => projectSkills.ensureReady(skillArgs),
  });

  return { projectSkills, agentLaunchGate, systemSkills };
}
