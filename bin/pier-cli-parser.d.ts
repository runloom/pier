import type { PierCommandEnvelope } from "../src/shared/contracts/commands.ts";

export interface ParsePierCliArgsOptions {
  clientEnv?: Record<string, string>;
  clientId?: string;
  cwd?: string;
  requestId?: string;
}

export interface ParsedPierCliV1 {
  envelope: PierCommandEnvelope;
  json: boolean;
  protocol: "v1";
}

export interface ParsedPierCliV2 {
  effectKey?: string;
  expectedBootId?: string;
  json: boolean;
  op: string;
  params: Record<string, unknown>;
  protocol: "v2";
  requestId: string;
  textSource?:
    | { kind: "inline"; text: string }
    | { kind: "file"; path: string }
    | { kind: "stdin" };
}

export type ParsedPierCliCommand = ParsedPierCliV1 | ParsedPierCliV2;

/** @deprecated 使用 ParsedPierCliCommand；旧代码若只认 envelope 需先判断 protocol */
export interface ParsedPierCliCommandLegacy {
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
