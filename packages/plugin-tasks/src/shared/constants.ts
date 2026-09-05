export const PLUGIN_ID = "pier.tasks";
export const GITHUB_TOKEN_SECRET = "github.token";
export const LINEAR_TOKEN_SECRET = "linear.token";
export const JIRA_TOKEN_SECRET = "jira.token";
export const JIRA_BASE_URL_SECRET = "jira.baseUrl";
export const LINEAR_PERSONAL_API_KEYS_URL =
  "https://linear.app/settings/account/security";
export const JIRA_API_TOKENS_URL =
  "https://id.atlassian.com/manage-profile/security/api-tokens";
export const STANDARD_LABELS = [
  "pier/todo",
  "pier/in-progress",
  "pier/done",
] as const;
export const COLUMN_CAP = 80;
export const POLL_INTERVAL_MS = 30_000;
export const POLL_UNFOCUSED_INTERVAL_MS = 120_000;
export const SCHEMA_VERSION = 2;
export const BOARD_PANEL_ID = "pier.tasks.board";
export const OPEN_BOARD_COMMAND_ID = "pier.tasks.openBoard";
/** Sentinel repo while a canvas applet resolves the project default source. */
export const UNRESOLVED_REPO = "-";
