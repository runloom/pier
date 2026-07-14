import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mergeOpenCodeInputs } from "./opencode-merge.ts";
import { createOpenCodeUsageScanner } from "./opencode-scanner.ts";
import { createOpenCodeSqliteScanner } from "./opencode-sqlite-scanner.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * OpenCode 会话用量采集器。同时覆盖两种存储布局：
 *
 * - **v1.2.0+ SQLite**（`<OPENCODE_DATA_DIR>/opencode.db`）— 走
 *   `opencode-sqlite-scanner`，用 `node:sqlite` 只读打开，busy timeout 5s。
 *   金标准选型：`node:sqlite` 是 Node 24 内置模块，Electron 42 底层是
 *   Node 24.15，无需 native rebuild、无需 electron-rebuild、无需 prebuild
 *   pipeline，规避 better-sqlite3 对 Electron 42 断供 prebuilds 的坑。
 *
 * - **v1.2.0 之前的 JSON storage**（`<OPENCODE_DATA_DIR>/storage/session/
 *   message/<sessionID>/<messageID>.json`）— 走 `opencode-scanner`。
 *
 * 用户视角：无论哪个 OpenCode 版本，装了就能被扫到。两个存储都存在时，用户
 * 数据以 SQLite 为主（v1.2+ 后 JSON 目录不再更新）。取"两者并集，SQLite 优先
 * 覆盖同 fingerprint"策略：即使 v1.1 -> v1.2 迁移期间同时留有两份数据，
 * 也不会双计。
 *
 * `detect()` 只要任一存储存在即返回 true；`rescan()` 分别拉两侧结果后合并。
 */

const OPENCODE_UNIFIED_SOURCE_ID = "opencode-local-sessions";

interface OpenCodePaths {
  dbPath: string;
  messageRoot: string;
}

function resolveOpenCodePaths(env: NodeJS.ProcessEnv): OpenCodePaths {
  const override = env.OPENCODE_DATA_DIR;
  const dataDir =
    override && override.length > 0
      ? override
      : join(env.HOME ?? homedir(), ".local", "share", "opencode");
  return {
    dbPath: join(dataDir, "opencode.db"),
    messageRoot: join(dataDir, "storage", "session", "message"),
  };
}

export const createOpenCodeUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const paths = resolveOpenCodePaths(context.env);
  const jsonScanner = createOpenCodeUsageScanner({
    cachePath: join(
      context.userDataDir,
      "usage-collectors",
      "opencode-json-cache.json"
    ),
    messageRoot: paths.messageRoot,
  });
  const sqliteScanner = createOpenCodeSqliteScanner({ dbPath: paths.dbPath });

  return {
    agentId: "opencode",
    detect: () => existsSync(paths.dbPath) || existsSync(paths.messageRoot),
    async rescan() {
      const [sqliteResult, jsonResult] = await Promise.all([
        sqliteScanner.scan().catch((error: unknown) => {
          context.logger.warn("opencode sqlite scan failed", {
            error: error instanceof Error ? error.message : error,
          });
          return null;
        }),
        jsonScanner.scan().catch((error: unknown) => {
          context.logger.warn("opencode json storage scan failed", {
            error: error instanceof Error ? error.message : error,
          });
          return null;
        }),
      ]);

      const sqliteInput = sqliteResult?.diagnostics.schemaValid
        ? { ...sqliteResult.input, sourceId: OPENCODE_UNIFIED_SOURCE_ID }
        : null;
      const jsonInput =
        jsonResult && jsonResult.input.observations.length > 0
          ? { ...jsonResult.input, sourceId: OPENCODE_UNIFIED_SOURCE_ID }
          : null;

      const merged = mergeOpenCodeInputs(sqliteInput, jsonInput);
      if (!merged || merged.observations.length === 0) return null;
      return merged;
    },
    sourceId: OPENCODE_UNIFIED_SOURCE_ID,
  };
};
