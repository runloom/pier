import type { PierCommandEnvelope } from "../src/shared/contracts/commands.ts";

export interface ParsePierCliArgsOptions {
  clientId?: string;
  cwd?: string;
  requestId?: string;
}

export interface ParsedPierCliCommand {
  envelope: PierCommandEnvelope;
  json: boolean;
}

export function hasPierCliOption(
  args: readonly string[],
  name: string
): boolean;

export function parsePierCliArgs(
  argv: readonly string[],
  options?: ParsePierCliArgsOptions
): ParsedPierCliCommand;

export function usage(): string;
