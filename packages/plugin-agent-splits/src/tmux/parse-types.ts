export type ParsedTmux =
  | { kind: "version" }
  | { kind: "error"; exitCode: number; message: string }
  | {
      flags: Record<string, string | true>;
      kind: "command";
      rest: string[];
      verb: string;
    };
