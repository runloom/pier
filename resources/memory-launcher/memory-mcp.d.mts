/** 启动器(随包资源,零依赖纯 Node)的类型声明,供契约测试与安装器消费。 */
export declare const ENGINE_COMMAND: readonly string[];

/** 与宿主 GUIDANCE_BODY 字节相等;注入 initialize.result.instructions。 */
export declare const MEMORY_INSTRUCTIONS: string;

export declare function applyMemoryInstructions(result: unknown): unknown;

export declare function isInitializeSuccess(message: unknown): boolean;

export declare function attachEngineStdoutIntercept(
  src: NodeJS.ReadableStream,
  dest: NodeJS.WritableStream
): void;

export declare function engineCommand(
  env: Record<string, string | undefined>
): readonly string[];

export declare function projectKeyForCommonDir(
  commonDirRealPath: string
): string;

export declare function deriveStorePathFromCwd(
  cwd: string,
  home?: string
): string | null;

export declare function resolveStorePath(
  env: Record<string, string | undefined>,
  cwd: string,
  home?: string
): string | null;

export declare function isStoreEnabled(storePath: string): boolean;

export interface MemoryStubResponse {
  error?: { code: number; message: string };
  id: number | string;
  jsonrpc: "2.0";
  result?: {
    protocolVersion?: string;
    serverInfo?: { name: string; version: string };
    tools?: unknown[];
  } & Record<string, unknown>;
}

export declare function stubResponse(message: {
  id?: number | string;
  jsonrpc?: string;
  method?: string;
  params?: Record<string, unknown>;
}): MemoryStubResponse | null;
