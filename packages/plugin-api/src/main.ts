/**
 * Public external main plugin API. External Codex plugin main import target.
 * DO NOT re-export host internal state — this file is the trust boundary
 * between host and external plugins (design §7.1).
 */

export interface MainPluginContext {
  events: {
    emit(event: string, payload: unknown): void;
  };
  lifecycle: {
    onBeforeQuit(callback: () => Promise<void> | void): void;
  };
  logger: {
    debug(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
  };
  paths: {
    dataDir: string;
    workDir: string;
  };
  plugin: {
    id: string;
    version: string;
  };
  processEnv: Readonly<Record<string, string | undefined>>;
  rpc: {
    handle(
      method: string,
      handler: (payload: unknown) => Promise<unknown>
    ): void;
  };
  secrets: {
    delete(key: string): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
}

export interface MainPluginModule {
  activate(context: MainPluginContext): (() => void) | Promise<() => void>;
  id: string;
}
