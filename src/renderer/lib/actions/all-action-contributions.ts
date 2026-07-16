import { TERMINAL_ACTION_CONTRIBUTIONS } from "@/panel-kits/terminal/register-actions.ts";
import { AGENT_RUNTIME_ACTION_CONTRIBUTIONS } from "./agent-runtime-actions.ts";
import { COMMAND_PALETTE_ACTION_CONTRIBUTIONS } from "./command-palette-action.ts";
import { COMMAND_PALETTE_MRU_ACTION_CONTRIBUTIONS } from "./command-palette-mru-action.ts";
import { CONFIG_ACTION_CONTRIBUTIONS } from "./config-actions.ts";
import type { ActionContribution } from "./contribution-types.ts";
import { NEW_AGENT_ACTION_CONTRIBUTIONS } from "./new-agent-action.ts";
import { PANEL_ACTION_CONTRIBUTIONS } from "./panel-actions.ts";
import { RUN_ACTION_CONTRIBUTIONS } from "./run-actions.ts";
import { SETTINGS_ACTION_CONTRIBUTIONS } from "./settings-actions.ts";
import { TERMINAL_DEBUG_ACTION_CONTRIBUTIONS } from "./terminal-debug-actions.ts";
import { VIEW_ACTION_CONTRIBUTIONS } from "./view-actions.ts";

export const ALL_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  ...COMMAND_PALETTE_ACTION_CONTRIBUTIONS,
  ...COMMAND_PALETTE_MRU_ACTION_CONTRIBUTIONS,
  ...CONFIG_ACTION_CONTRIBUTIONS,
  ...NEW_AGENT_ACTION_CONTRIBUTIONS,
  ...AGENT_RUNTIME_ACTION_CONTRIBUTIONS,
  ...PANEL_ACTION_CONTRIBUTIONS,
  ...RUN_ACTION_CONTRIBUTIONS,
  ...SETTINGS_ACTION_CONTRIBUTIONS,
  ...TERMINAL_ACTION_CONTRIBUTIONS,
  ...TERMINAL_DEBUG_ACTION_CONTRIBUTIONS,
  ...VIEW_ACTION_CONTRIBUTIONS,
];
