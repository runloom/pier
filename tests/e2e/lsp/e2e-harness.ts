import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { lspSessionCloseCauseSchema } from "@shared/contracts/lsp.ts";
import { z } from "zod";
import {
  APP_CLOSE_TIMEOUT_MS,
  killAndWait,
  OUT_MAIN,
  PROJECT_ROOT,
  removeDirectory,
  runPierCliJson,
} from "../terminal/e2e-harness.ts";

const OBSERVER_GLOBAL = "__PIER_LSP_E2E_OBSERVER__";
const TAB_PREFIX = "pier.files.filePanel:disk:";
const GROUP_VIEW = '[data-slot="pier.files.groupView"]';
const READY_WORKSPACE =
  '[data-testid="workspace-host-root"][data-workspace-ready="true"]';
const snapshotSchema = z.object({
  alive: z.boolean(),
  clientRole: z.string(),
  closeCause: lspSessionCloseCauseSchema.nullable(),
  pid: z.number().int().nullable(),
  rootPath: z.string(),
  serverId: z.string(),
  sessionId: z.string(),
  startedAt: z.number(),
  treeTerminal: z.boolean(),
  workspaceKey: z.string(),
});
const reportSchema = z.object({
  liveProcessTrees: z.array(snapshotSchema),
  sessions: z.array(snapshotSchema),
  shutdownCompleted: z.literal(true),
});

export const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
export const MOD_I = `${MOD_KEY}+KeyI`;
export type ObserverCloseCause = "idle-release" | "workspace-evicted";
export type LspE2eSessionSnapshot = z.infer<typeof snapshotSchema>;
export type LspE2eReport = z.infer<typeof reportSchema>;
export type LspFixtureFileName =
  | "first.ts"
  | "second.ts"
  | "tsconfig.json"
  | "unsupported.txt";

export interface LspE2eFixture {
  app: ElectronApplication;
  application: ElectronApplication;
  cleanup(): Promise<void>;
  closeApplication(): Promise<void>;
  markApplicationClosed(): void;
  observerSnapshot(): Promise<LspE2eSessionSnapshot[]>;
  openFile(
    name: LspFixtureFileName,
    options?: { pin?: boolean }
  ): Promise<Locator>;
  page: Page;
  reportPath: string;
  userDataDir: string;
  workspaceDir: string;
}

type LocatorRoot = Pick<Locator, "locator"> | Pick<Page, "locator">;
type LanguageState =
  | "disabled"
  | "error"
  | "paused"
  | "ready"
  | "retrying"
  | "starting"
  | "unsupported";

export function languageStatus(
  root: LocatorRoot,
  state?: LanguageState
): Locator {
  return root.locator(
    `[data-language-service-status${state ? `="${state}"` : ""}]`
  );
}
export function languageBadge(root: LocatorRoot, language?: string): Locator {
  return root.locator(
    `[data-slot="badge"][data-language${language ? `="${language}"` : ""}]`
  );
}
export function saveStatus(root: LocatorRoot): Locator {
  return root.locator(
    '[role="status"][title="Saved"], [role="status"][title="已保存"]'
  );
}

/**
 * Ready is intentionally silent in the status bar (no "Ready" badge).
 * E2E readiness is observed via the LSP session observer instead.
 */
export async function waitForEditorLspReady(
  fixture: Pick<LspE2eFixture, "observerSnapshot" | "workspaceDir">,
  options?: { serverId?: string; timeout?: number }
): Promise<void> {
  const timeout = options?.timeout ?? 60_000;
  const serverId = options?.serverId;
  await expect
    .poll(
      async () => {
        const sessions = await fixture.observerSnapshot();
        const workspaceRoot = realpathSync(fixture.workspaceDir);
        return sessions.some(
          (session) =>
            session.alive &&
            session.clientRole === "editor" &&
            session.pid !== null &&
            realpathSync(session.rootPath) === workspaceRoot &&
            (serverId === undefined || session.serverId === serverId)
        );
      },
      { timeout }
    )
    .toBe(true);
}

export async function observerSnapshot(
  application: ElectronApplication
): Promise<LspE2eSessionSnapshot[]> {
  const value = await application.evaluate(
    async (_, { globalName }) => {
      const observer = Reflect.get(globalThis, globalName);
      if (!(observer && typeof observer === "object"))
        throw new Error(`Missing ${globalName}`);
      const operation = Reflect.get(observer, "snapshot");
      if (typeof operation !== "function")
        throw new Error(`${globalName}.snapshot is not callable`);
      return await Reflect.apply(operation, observer, []);
    },
    { globalName: OBSERVER_GLOBAL }
  );
  return z.array(snapshotSchema).parse(value);
}
export async function observerTerminate(
  application: ElectronApplication,
  sessionId: string
): Promise<boolean> {
  return await invokeObserver(application, "terminate", sessionId);
}
export async function observerClose(
  application: ElectronApplication,
  sessionId: string,
  cause: ObserverCloseCause
): Promise<boolean> {
  return await invokeObserver(application, "close", sessionId, cause);
}
export function readLspE2eReport(reportPath: string): LspE2eReport {
  const value: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
  return reportSchema.parse(value);
}
export const readObserverReport = readLspE2eReport;

export async function createLspE2eFixture(): Promise<LspE2eFixture> {
  const { userDataDir, workspaceDir } = createTemporaryDirectories();
  const reportPath = join(userDataDir, "lsp-observer-report.json");
  let application: ElectronApplication;
  try {
    application = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR: userDataDir,
        PIER_LSP_E2E_OBSERVER: "1",
        PIER_LSP_E2E_REPORT_PATH: reportPath,
      },
    });
  } catch (error) {
    removeDirectory(workspaceDir);
    removeDirectory(userDataDir);
    throw error;
  }

  let applicationClosed = false;
  let page: Page;
  const markApplicationClosed = (): void => {
    applicationClosed = true;
  };
  const closeApplication = async (): Promise<void> => {
    if (applicationClosed || processHasExited(application)) {
      applicationClosed = true;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const closed = await Promise.race([
      application.close().then(
        () => true,
        () => false
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), APP_CLOSE_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (!closed) await killAndWait(application.process());
    applicationClosed = true;
  };
  try {
    page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(READY_WORKSPACE)).toBeVisible({
      timeout: 30_000,
    });
    await openWorkspaceTerminal(userDataDir, workspaceDir);
    await openWorkspaceTree(page);
  } catch (error) {
    await closeApplication().catch(() => undefined);
    removeDirectory(workspaceDir);
    removeDirectory(userDataDir);
    throw error;
  }

  const openFile = async (
    name: LspFixtureFileName,
    options?: { pin?: boolean }
  ): Promise<Locator> => {
    const item = await visibleTreeFile(page, name);
    await item.click();
    if (options?.pin) await item.click();
    const tab = page
      .locator(`[data-panel-tab-id^="${TAB_PREFIX}"]`)
      .filter({ hasText: name })
      .last();
    await expect(tab).toBeVisible({ timeout: 30_000 });
    const group = tab.locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-groupview ')][1]"
    );
    const content = group.locator(GROUP_VIEW);
    await tab.click();
    await expect(content).toBeVisible({ timeout: 30_000 });
    await expect(content).toContainText(name, { timeout: 30_000 });
    return content;
  };
  return {
    app: application,
    application,
    cleanup: async () => {
      try {
        await closeApplication();
      } finally {
        removeDirectory(workspaceDir);
        removeDirectory(userDataDir);
      }
    },
    closeApplication,
    markApplicationClosed,
    observerSnapshot: async () => await observerSnapshot(application),
    openFile,
    page,
    reportPath,
    userDataDir,
    workspaceDir,
  };
}

async function invokeObserver(
  application: ElectronApplication,
  method: "close" | "terminate",
  sessionId: string,
  cause?: ObserverCloseCause
): Promise<boolean> {
  const result = await application.evaluate(
    async (_, { globalName, methodName, args }) => {
      const observer = Reflect.get(globalThis, globalName);
      if (!(observer && typeof observer === "object"))
        throw new Error(`Missing ${globalName}`);
      const operation = Reflect.get(observer, methodName);
      if (typeof operation !== "function")
        throw new Error(`${globalName}.${methodName} is not callable`);
      return await Reflect.apply(operation, observer, args);
    },
    {
      args: cause ? [sessionId, cause] : [sessionId],
      globalName: OBSERVER_GLOBAL,
      methodName: method,
    }
  );
  return z.boolean().parse(result);
}

async function openWorkspaceTerminal(
  userDataDir: string,
  workspaceDir: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const result = await runPierCliJson<{ panelId: string }>(
            userDataDir,
            ["terminal", "open", "--cwd", workspaceDir]
          );
          return result.ok && Boolean(result.data?.panelId);
        } catch {
          return false;
        }
      },
      { timeout: 20_000 }
    )
    .toBe(true);
}
async function openWorkspaceTree(page: Page): Promise<void> {
  const trigger = page.locator('[data-testid="files-project-status-trigger"]');
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  await expect(
    page.getByRole("treeitem", { exact: true, name: "first.ts" })
  ).toBeVisible({ timeout: 30_000 });
}
async function visibleTreeFile(
  page: Page,
  name: LspFixtureFileName
): Promise<Locator> {
  const item = page.getByRole("treeitem", { exact: true, name });
  if (!(await item.isVisible())) await openWorkspaceTree(page);
  await expect(item).toBeVisible({ timeout: 30_000 });
  return item;
}
function processHasExited(application: ElectronApplication): boolean {
  const child = application.process();
  return child.exitCode !== null || child.signalCode !== null;
}
function writeWorkspace(workspaceDir: string): void {
  writeFileSync(
    join(workspaceDir, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler", noEmit: true, strict: true, target: "ES2022" }, include: ["*.ts"] }, null, 2)}\n`
  );
  writeFileSync(
    join(workspaceDir, "first.ts"),

    `/** Returns a friendly greeting. */\nexport function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nexport const message = greet("Pier");\n`
  );
  writeFileSync(
    join(workspaceDir, "second.ts"),
    `import { greet } from "./first";\n\nexport const secondMessage = greet("Second");\n`
  );
  writeFileSync(
    join(workspaceDir, "unsupported.txt"),
    "This file intentionally has no language server.\n"
  );
}
function createTemporaryDirectories(): {
  userDataDir: string;
  workspaceDir: string;
} {
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-lsp-user-data-"));
  let workspaceDir: string | undefined;
  try {
    workspaceDir = mkdtempSync(join(tmpdir(), "pier-lsp-workspace-"));
    writeWorkspace(workspaceDir);
    return { userDataDir, workspaceDir };
  } catch (error) {
    if (workspaceDir) removeDirectory(workspaceDir);
    removeDirectory(userDataDir);
    throw error;
  }
}
