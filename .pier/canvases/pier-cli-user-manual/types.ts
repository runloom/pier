import type { CmdStatus } from "./status.ts";

export type CommandDetail = {
  id: string;
  name: string;
  status: CmdStatus;
  synopsis: string;
  description: string;
  examples?: string[];
  humanSample?: string;
  output?: string;
};

export type Domain = {
  id: string;
  label: string;
  blurb: string;
  commands: CommandDetail[];
};

export type Task = {
  id: string;
  title: string;
  when: string;
  steps: string[];
};

export type ManualData = {
  meta: {
    title: string;
    subtitle: string;
    status: string;
    version: string;
  };
  bluf: string;
  context: string;
  goals: string[];
  nonGoals: string[];
  design: { readingSpine: string; iaNotes?: string[]; principles?: string[] };
  alternatives: { name: string; rejectReason: string }[];
  quickStart: {
    prerequisite: string;
    firstCommands: { title: string; cmd: string; note: string }[];
    binPaths: string[];
  };
  globalOptions: { flag: string; meaning: string }[];
  outputShapes: { success: string; failure: string };
  tasks: Task[];
  domains: Domain[];
  agents: {
    intro: string;
    shipped: CommandDetail[];
    planned: CommandDetail[];
  };
  faq: { q: string; a: string }[];
};

export type Payload = {
  schemaVersion: number;
  data: ManualData;
};
