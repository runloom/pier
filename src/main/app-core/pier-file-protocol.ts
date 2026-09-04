import { resolve } from "node:path";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type { TerminalPathLocation } from "@shared/terminal-local-path.ts";
import { parsePierFileUrl } from "@shared/terminal-local-path.ts";
import { resolveCommandWindow } from "./window-routing.ts";

export { PIER_FILE_PROTOCOL_PANEL_ID } from "@shared/terminal-local-path.ts";

export type PierFileOpenTarget = TerminalPathLocation;

export class PierFileNoWindowError extends Error {
  readonly code = "no-window";

  constructor() {
    super("no renderer window available");
    this.name = "PierFileNoWindowError";
  }
}

export function isPierFileNoWindowError(error: unknown): boolean {
  return error instanceof PierFileNoWindowError;
}

export interface PierFileProtocolHost {
  handle(url: string): Promise<boolean>;
  markReady(): Promise<void>;
}

export interface PierFileProtocolAppAdapter {
  on(
    event: "open-url",
    listener: (event: { preventDefault(): void }, url: string) => void
  ): unknown;
  on(
    event: "second-instance",
    listener: (event: unknown, argv: readonly string[]) => void
  ): unknown;
  setAsDefaultProtocolClient(
    protocol: string,
    path?: string,
    args?: readonly string[]
  ): boolean;
}

const PIER_SCHEME = "pier";

export function protocolUrlsFromArgv(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg.startsWith(`${PIER_SCHEME}:`));
}

export function formatPierFileUrl(target: PierFileOpenTarget): string {
  const normalized = target.path.replace(/\\/g, "/");
  const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const encoded = withSlash
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  let url = `${PIER_SCHEME}://file${encoded}`;
  if (target.line === undefined) {
    return url;
  }
  url += `#L${target.line}`;
  if (target.column !== undefined) {
    url += `C${target.column}`;
  }
  return url;
}

export function createPierFileProtocolHost(options: {
  logError: (error: unknown) => void;
  openFile: (target: PierFileOpenTarget) => Promise<void>;
}): PierFileProtocolHost {
  let ready = false;
  const queued: string[] = [];

  async function open(url: string): Promise<boolean> {
    const target = parsePierFileUrl(url);
    if (!target) {
      return false;
    }
    try {
      await options.openFile(target);
      return true;
    } catch (error) {
      if (isPierFileNoWindowError(error)) {
        queued.push(url);
        return true;
      }
      options.logError(error);
      return true;
    }
  }

  return {
    async handle(url: string): Promise<boolean> {
      if (!parsePierFileUrl(url)) {
        return false;
      }
      if (!ready) {
        queued.push(url);
        return true;
      }
      return await open(url);
    },
    async markReady(): Promise<void> {
      ready = true;
      const pending = queued.splice(0);
      for (const url of pending) {
        await open(url);
      }
    },
  };
}

function electronWindowIdFromInfo(window: WindowInfo): number | null {
  const raw = window.electronWindowId;
  if (raw === undefined) {
    return null;
  }
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function createPierFileProtocolHostForServices(options: {
  dispatchOpenUrl: (input: { url: string; windowElectronId: number }) => void;
  logError: (error: unknown) => void;
  window: { list(): WindowInfo[] };
}): PierFileProtocolHost {
  return createPierFileProtocolHost({
    logError: options.logError,
    openFile: async (target) => {
      const resolved = resolveCommandWindow(undefined, options, {
        requireStableDefault: true,
      });
      const windowElectronId = resolved.window
        ? electronWindowIdFromInfo(resolved.window)
        : null;
      if (windowElectronId == null) {
        throw new PierFileNoWindowError();
      }
      options.dispatchOpenUrl({
        url: formatPierFileUrl(target),
        windowElectronId,
      });
    },
  });
}

export function attachPierFileProtocol(input: {
  app: PierFileProtocolAppAdapter;
  argv?: readonly string[];
  defaultApp?: boolean;
  execPath?: string;
  host: PierFileProtocolHost;
}): void {
  const argv = input.argv ?? process.argv;
  const execPath = input.execPath ?? process.execPath;
  if (input.defaultApp === true) {
    const script = argv[1];
    if (script) {
      input.app.setAsDefaultProtocolClient(PIER_SCHEME, execPath, [
        resolve(script),
      ]);
    }
  } else {
    input.app.setAsDefaultProtocolClient(PIER_SCHEME);
  }

  input.app.on("open-url", (event, url) => {
    event.preventDefault();
    handleProtocolUrl(input.host, url);
  });
  input.app.on("second-instance", (_event, commandLine) => {
    for (const url of protocolUrlsFromArgv(commandLine)) {
      handleProtocolUrl(input.host, url);
    }
  });
  for (const url of protocolUrlsFromArgv(argv)) {
    handleProtocolUrl(input.host, url);
  }
}

function handleProtocolUrl(host: PierFileProtocolHost, url: string): void {
  host.handle(url).catch(() => undefined);
}
