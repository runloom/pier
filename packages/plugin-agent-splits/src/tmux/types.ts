export type JsonCommand = Record<string, unknown> & { type: string };

export type ControlResult =
  | { data: unknown; ok: true; requestId: string }
  | {
      error: { code: string; message: string };
      ok: false;
      requestId: string;
    };

export type TmuxFlags = Record<string, string | true>;

export interface RunTmuxResult {
  commands: JsonCommand[];
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface TmuxRuntime {
  /** 发起 tmux 调用的进程 cwd（= agent 终端 cwd）；缺省由 shim 兜底 process.cwd()。 */
  cwd?: string;
  env: NodeJS.Dict<string>;
  invoke: (command: JsonCommand) => Promise<ControlResult>;
  now?: number;
  sleep?: (ms: number) => Promise<void>;
  waitTimeoutMs?: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resultErrorMessage(result: ControlResult): string {
  if (result.ok) {
    return "";
  }
  return result.error.message;
}

export function resultDataRecord(
  result: ControlResult
): Record<string, unknown> | null {
  if (!(result.ok && isRecord(result.data))) {
    return null;
  }
  return result.data;
}
