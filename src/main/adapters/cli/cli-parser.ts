import {
  type ParsedPierCliCommand,
  type ParsePierCliArgsOptions,
  parsePierCliArgs as parseSharedPierCliArgs,
} from "../../../../bin/pier-cli-parser.js";

export type {
  ParsedPierCliCommand,
  ParsePierCliArgsOptions,
} from "../../../../bin/pier-cli-parser.js";

export function parsePierCliArgs(
  argv: readonly string[],
  options?: ParsePierCliArgsOptions
): ParsedPierCliCommand {
  return parseSharedPierCliArgs(argv, options);
}
