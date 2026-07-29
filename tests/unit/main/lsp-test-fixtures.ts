import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Mock } from "vitest";
import { vi } from "vitest";
import { LspMessageReader } from "../../../src/main/services/lsp/lsp-message-codec.ts";

export class FakeLspChild extends EventEmitter {
  readonly pid: number;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: NodeJS.Signals[] = [];
  killed = false;

  constructor(pid = 4242) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    this.signals.push(signal);
    return true;
  }

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}
export class FakeWindowsSupervisorChild extends FakeLspChild {
  readonly controlInput = new PassThrough();
  readonly controlOutput = new PassThrough();
  readonly stdio = [
    this.stdin,
    this.stdout,
    this.stderr,
    this.controlInput,
    this.controlOutput,
  ] as const;
}

export interface FakeProcessTree {
  readonly close: Mock<() => Promise<void>>;
  readonly forceTerminate: Mock<() => Promise<void>>;
  readonly gracefulTerminate: Mock<() => Promise<void>>;
  readonly isAlive: Mock<() => Promise<boolean>>;
  resolveTerminal(): void;
  setAlive(alive: boolean): void;
  readonly terminal: Promise<void>;
}

export function createFakeProcessTree(initiallyAlive = true): FakeProcessTree {
  let alive = initiallyAlive;
  const terminal = Promise.withResolvers<void>();
  let settled = false;
  const tree: FakeProcessTree = {
    close: vi.fn(async () => undefined),
    forceTerminate: vi.fn(async () => undefined),
    gracefulTerminate: vi.fn(async () => undefined),
    isAlive: vi.fn(async () => alive),
    terminal: terminal.promise,
    resolveTerminal() {
      if (settled) {
        return;
      }
      settled = true;
      alive = false;
      terminal.resolve();
    },
    setAlive(nextAlive) {
      alive = nextAlive;
    },
  };
  if (!initiallyAlive) {
    tree.resolveTerminal();
  }
  return tree;
}

export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export function recordLspMessages(stream: PassThrough): {
  readonly bodies: string[];
  readonly messages: Record<string, unknown>[];
} {
  const reader = new LspMessageReader();
  const bodies: string[] = [];
  const messages: Record<string, unknown>[] = [];
  stream.on("data", (chunk: Buffer) => {
    for (const body of reader.push(chunk)) {
      bodies.push(body);
      messages.push(JSON.parse(body) as Record<string, unknown>);
    }
  });
  return { bodies, messages };
}
