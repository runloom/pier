import { createConnection } from "node:net";
import type {
  PierCommandEnvelope,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  type ParsePierCliArgsOptions,
  parsePierCliArgs,
} from "./cli-parser.ts";

export interface PierLocalCommandTransport {
  request(envelope: PierCommandEnvelope): Promise<PierCommandResult>;
}

export interface PierCliCommandClient {
  run(argv: readonly string[]): Promise<PierCommandResult>;
}

export interface CreatePierCliCommandClientArgs {
  parseOptions?: ParsePierCliArgsOptions;
  transport: PierLocalCommandTransport;
}

export interface CreateLocalControlTransportArgs {
  socketPath: string;
  timeoutMs?: number;
}

function parseResult(line: string): PierCommandResult {
  return JSON.parse(line) as PierCommandResult;
}

export function createLocalControlTransport({
  socketPath,
  timeoutMs = 5000,
}: CreateLocalControlTransportArgs): PierLocalCommandTransport {
  return {
    request(envelope) {
      return new Promise((resolve, reject) => {
        const socket = createConnection(socketPath);
        let body = "";
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error(`timed out connecting to Pier at ${socketPath}`));
        }, timeoutMs);

        socket.setEncoding("utf8");
        socket.on("connect", () => {
          socket.write(`${JSON.stringify(envelope)}\n`);
        });
        socket.on("data", (chunk) => {
          body += chunk;
        });
        socket.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        socket.on("end", () => {
          clearTimeout(timer);
          try {
            resolve(parseResult(body.trim()));
          } catch (error) {
            reject(error);
          }
        });
      });
    },
  };
}

export function createPierCliCommandClient({
  parseOptions,
  transport,
}: CreatePierCliCommandClientArgs): PierCliCommandClient {
  return {
    run(argv) {
      const parsed = parsePierCliArgs(argv, parseOptions);
      return transport.request(parsed.envelope);
    },
  };
}
