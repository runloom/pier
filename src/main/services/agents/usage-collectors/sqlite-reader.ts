import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

/**
 * SQLite 只读读取器 primitive。抽象 `node:sqlite` 的常用操作，供
 * usage-collectors 内多 agent（OpenCode、未来 Hermes / Cursor 等）复用。
 *
 * 设计约束（业界最佳实践）：
 * - 只读打开（`readOnly: true`）：不锁写、不意外修改外部 CLI 拥有的 DB 文件。
 * - `busy timeout`（默认 5s）：容忍目标 CLI 并发写入 WAL；宁等勿抛。
 * - schema-drift 容忍：`describeColumns(table)` 返回列存在性 → 调用方按需
 *   降级。OpenCode / Hermes 等 CLI 会随版本演化 schema，硬编码列会脆。
 * - prepared-statement 缓存：LRU 由 node:sqlite 的 SQLTagStore 提供；但我们
 *   走朴素 `prepare()`（不用 tag template）便于 SQL 单元测试断言。
 * - dispose 幂等：`Symbol.dispose` + `close()` 均可多次调用。
 * - 结构化错误：不透传 native error，包装成 `SqliteReaderError`。
 *
 * 只读语义特别说明：
 *   node:sqlite 的 `readOnly: true` 底层是 `SQLITE_OPEN_READONLY`——connection
 *   自身不写；但 WAL 模式的目标 DB 仍会在读时把 shared memory 映射打开
 *   (`-shm` / `-wal` sidecar)。这是 SQLite 内部对 shared-cache 协调的必要
 *   行为，不算"污染"。若担心极端场景（e.g. 只读文件系统），未来可切
 *   `SQLITE_OPEN_READONLY | SQLITE_OPEN_URI` + `?immutable=1`（当前 node:sqlite
 *   不直接暴露 URI mode，需要 backup API 或未来加 flag）。
 */

const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const nodeRequire = createRequire(import.meta.url);

function databaseSyncConstructor(): typeof DatabaseSync {
  // 延迟到确实发现 OpenCode DB 后再加载。renderer 侧集成测试会导入完整
  // app-core 图，但不应尝试把仅主进程可用的 node:sqlite 打进浏览器环境。
  return (nodeRequire("node:sqlite") as { DatabaseSync: typeof DatabaseSync })
    .DatabaseSync;
}

export class SqliteReaderError extends Error {
  override readonly cause?: unknown;
  readonly path: string;
  constructor(message: string, options: { cause?: unknown; path: string }) {
    super(message);
    this.name = "SqliteReaderError";
    this.path = options.path;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface SqliteColumnInfo {
  name: string;
  notNull: boolean;
  primaryKey: boolean;
  type: string;
}

export interface SqliteReaderOptions {
  /** busy timeout in ms; SQLite 会等这么久让写者释放锁。默认 5s。 */
  busyTimeoutMs?: number;
  path: string;
}

export interface SqliteReader {
  /** 关闭连接；幂等。 */
  close(): void;
  /** 拉表列信息；用于 schema drift 检测。表不存在返回空数组。 */
  describeColumns(table: string): readonly SqliteColumnInfo[];
  /**
   * 只读快照拉取。SQL 必须只含 SELECT / PRAGMA；参数化绑定防注入。
   * 参数按位置绑定，与 `?` 占位符一一对应。
   */
  query<T>(sql: string, ...params: readonly SqliteBindable[]): readonly T[];
  /** 单行版本；无行返回 null。 */
  queryOne<T>(sql: string, ...params: readonly SqliteBindable[]): T | null;
  /** 表是否存在（`sqlite_master` 查询）。 */
  tableExists(table: string): boolean;
}

/** node:sqlite 支持绑定的原生类型。跟 `SQLInputValue` 保持一致。 */
export type SqliteBindable = Uint8Array | bigint | number | string | null;

/**
 * 打开只读 SQLite 连接。若目标文件不存在，立刻返回 null，调用方走"未检测到"
 * 分支即可（不当异常，因为常见于用户未安装该 CLI）。
 */
export function openSqliteReader(
  options: SqliteReaderOptions
): SqliteReader | null {
  if (!existsSync(options.path)) return null;
  let db: DatabaseSync;
  try {
    const Database = databaseSyncConstructor();
    db = new Database(options.path, {
      readOnly: true,
      timeout: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    throw new SqliteReaderError(
      `failed to open sqlite database: ${options.path}`,
      { cause: error, path: options.path }
    );
  }

  function assertOpen(): void {
    if (!db.isOpen) {
      throw new SqliteReaderError("database is closed", { path: options.path });
    }
  }

  return {
    close(): void {
      if (db.isOpen) {
        try {
          db.close();
        } catch {
          // best-effort; multiple close is safe by node:sqlite semantics
        }
      }
    },
    describeColumns(table: string): readonly SqliteColumnInfo[] {
      assertOpen();
      try {
        // PRAGMA table_info returns rows with cid/name/type/notnull/pk/dflt_value.
        // table name 不能参数化——PRAGMA 语法限制；先做严格白名单校验。
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
          throw new SqliteReaderError(
            `invalid table name for PRAGMA table_info: ${table}`,
            { path: options.path }
          );
        }
        const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
          readonly [column: string]: unknown;
        }[];
        return rows.map((row) => ({
          name: typeof row.name === "string" ? row.name : "",
          notNull: typeof row.notnull === "number" && row.notnull !== 0,
          primaryKey: typeof row.pk === "number" && row.pk !== 0,
          type: typeof row.type === "string" ? row.type : "",
        }));
      } catch (error: unknown) {
        if (error instanceof SqliteReaderError) throw error;
        throw new SqliteReaderError(`failed to describe columns of ${table}`, {
          cause: error,
          path: options.path,
        });
      }
    },
    query<T>(sql: string, ...params: readonly SqliteBindable[]): readonly T[] {
      assertOpen();
      try {
        const rows = db.prepare(sql).all(...params) as unknown;
        return rows as readonly T[];
      } catch (error: unknown) {
        throw new SqliteReaderError(`sqlite query failed: ${sql}`, {
          cause: error,
          path: options.path,
        });
      }
    },
    queryOne<T>(sql: string, ...params: readonly SqliteBindable[]): T | null {
      assertOpen();
      try {
        const row = db.prepare(sql).get(...params) as unknown;
        return row === undefined ? null : (row as T);
      } catch (error: unknown) {
        throw new SqliteReaderError(`sqlite query failed: ${sql}`, {
          cause: error,
          path: options.path,
        });
      }
    },
    tableExists(table: string): boolean {
      assertOpen();
      const row = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?")
        .get("table", table) as unknown;
      return row !== undefined;
    },
  };
}

/**
 * `using`-style 便捷 wrapper：把 reader 传给 callback，回执前保证 close。
 * 未来 TS `using` explicit resource management 稳定后可换成语言级 syntax，
 * 现在手写 try/finally 兼容所有 target。
 */
export function withSqliteReader<T>(
  options: SqliteReaderOptions,
  fn: (reader: SqliteReader) => T
): T | null {
  const reader = openSqliteReader(options);
  if (!reader) return null;
  try {
    return fn(reader);
  } finally {
    reader.close();
  }
}
