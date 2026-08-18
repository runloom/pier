export function applyTmuxFormat(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(
    /#\{([a-z_]+)\}/g,
    (_all, name: string) => vars[name] ?? ""
  );
}

export function paneFormatVars(input: {
  paneId: string;
  path?: string;
  windowId: string;
}): Record<string, string> {
  const index = input.paneId.startsWith("%")
    ? input.paneId.slice(1)
    : input.paneId;
  return {
    pane_current_path: input.path ?? "",
    pane_id: input.paneId,
    pane_index: index,
    session_name: input.windowId,
    window_id: input.windowId,
  };
}
