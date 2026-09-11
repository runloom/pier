export const SIDEBAR_DESIGN_CSS = `
.sv4 { --sv-inset:8px; --sv-step:12px; --sv-icon:16px; --sv-status:16px; display:flex; flex-direction:column; height:100%; min-height:0; width:100%; position:relative; isolation:isolate; container:sv4 / inline-size; font-family:var(--pier-ui-font-family); color:var(--sidebar-foreground); background:var(--sidebar); border-right:1px solid var(--sidebar-border); }
.sv4 * { box-sizing:border-box; }
.sv4 .sv-head { flex:none; padding:0 8px 12px; }
.sv4 .sv-chrome { height:44px; display:flex; align-items:center; justify-content:space-between; padding:0 4px; }
.sv4 .sv-traffic { display:flex; gap:8px; }
.sv4 .sv-traffic i { width:10px; height:10px; border-radius:50%; background:var(--muted-foreground); opacity:.38; }
.sv4 .sv-scroll { min-height:0; flex:1; overflow-y:auto; overflow-x:hidden; padding:10px 8px 16px; }
.sv4 .sv-section + .sv-section { margin-top:20px; }
.sv4 .sv-section-head { height:28px; display:flex; align-items:center; justify-content:space-between; padding-left:8px; margin-bottom:6px; }
.sv4 .sv-section-head h2 { margin:0; color:var(--sidebar-foreground); font-size:11px; font-weight:500; line-height:16px; }
.sv4 .sv-list { list-style:none; display:flex; flex-direction:column; gap:2px; margin:0; padding:0; }
.sv4 .sv-list > li > .sv-list:not(:empty) { margin-top:2px; }
.sv4 .sv-worktrees { gap:8px; }
.sv4 .sv-project + .sv-project { margin-top:10px; }
.sv4 .sv-project-wrap { position:relative; }
.sv4 .sv-row { display:grid; grid-template-columns:var(--sv-icon) minmax(0,1fr) auto var(--sv-status); column-gap:6px; width:100%; padding-inline:var(--sv-inset); text-align:start; }
/* Item hover uses muted, identical to sidebar; use the host chrome hover token. */
.sv4 .sv-row:not([data-selected=true]):not([data-located=true]):hover { background:var(--list-hover-bg); }
.sv4 .sv-row[data-selected=true] { background:var(--list-active-bg); }
.sv4 .sv-project-row .sv-name-text { padding-right:28px; }
.sv4 .sv-project-wrap .sv-create { position:absolute; top:2px; right:30px; opacity:0; pointer-events:none; }
/* icon-xs: 24px paint; expand to a 28px pointer target. */
.sv4 .sv-create::after { content:""; position:absolute; inset:-2px; }
.sv4 .sv-project-wrap:hover .sv-create,.sv4 .sv-project-wrap:focus-within .sv-create { opacity:1; pointer-events:auto; }
.sv4 .sv-worktree { padding-inline-start:calc(var(--sv-inset) + var(--sv-step)); }
/* The nested list owns indentation, so its hit targets and highlights are nested too. */
.sv4 .sv-sessions:not(:empty) { width:auto; margin-inline-start:calc(var(--sv-inset) + var(--sv-step) + var(--sv-icon) / 2); padding-inline-start:7px; border-inline-start:1px solid var(--sidebar-border); }
.sv4 .sv-session[data-located=true] { background:var(--list-active-bg); }
.sv4 .sv-session[data-elsewhere=true] { outline:1px solid var(--ring); outline-offset:-1px; }
.sv4 .sv-local .sv-worktree-group { --sv-step:0px; }
.sv4 .sv-name { display:flex; gap:6px; align-items:center; min-width:0; }
.sv4 .sv-name-text { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.sv4 .sv-name-text[data-unread=true] { font-weight:600; }
.sv4 .sv-leading { width:var(--sv-icon); height:var(--sv-icon); display:flex; align-items:center; justify-content:center; }
.sv4 .sv-identity { --sv-identity-fallback:var(--sv-identity-dark); width:8px; height:8px; border-radius:2px; }
:root.light .sv4 .sv-identity { --sv-identity-fallback:var(--sv-identity-light); }
.sv4 .sv-state { display:flex; align-items:center; justify-content:center; width:var(--sv-status); height:var(--sv-status); grid-column:4; }
.sv4 .sv-dot { width:6px; height:6px; border-radius:50%; background:var(--status-neutral-fg); }
.sv4 .sv-state[data-status=attention] .sv-dot { background:var(--status-warning-fg); opacity:1; }
.sv4 .sv-session .sv-state[data-status=attention] .sv-dot { width:7px; height:7px; }
.sv4 .sv-state[data-status=running] .sv-dot { background:var(--status-info-fg); opacity:1; }
.sv4 .sv-summary { display:inline-flex; justify-content:flex-end; gap:4px; min-width:0; color:var(--sidebar-foreground); font-size:11px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.sv4 .sv-summary-full { display:inline-flex; gap:4px; }
.sv4 .sv-added { color:var(--success); }
.sv4 .sv-removed { color:var(--status-danger-fg); }
.sv4 .sv-summary-count { display:none; }
/* The same sidebar backplate used by update indicators keeps the blue dot legible. */
.sv4 .sv-state[data-status=running] .sv-dot { box-shadow:0 0 0 2px var(--sidebar); }
.sv4 .sv-window-label { display:flex; align-items:center; gap:3px; max-width:88px; min-width:0; font-size:11px; color:var(--sidebar-foreground); }
.sv4 .sv-window-label > span { white-space:nowrap; text-overflow:ellipsis; overflow:hidden; }
.sv4 .sv-window-label svg { flex:none; }
.sv4 .sv-footer { display:flex; align-items:center; gap:6px; flex:none; padding:9px 8px; }
.sv4 .sv-tool { position:relative; }
.sv4 .sv-settings { margin-inline-end:auto; min-width:0; flex-shrink:1; padding-inline:8px; }
.sv4 .sv-update-indicator { position:absolute; right:2px; top:2px; width:5px; height:5px; border-radius:50%; background:var(--status-info-fg); box-shadow:0 0 0 2px var(--sidebar); }
.sv4 .sv-tool[data-phase=downloading] { padding-inline:8px; }
.sv4 .sv-update-label { font-variant-numeric:tabular-nums; }
.sv4 .sv-empty { padding:18px 8px; }
.sv4 .sv-status-copy { margin:8px; font-size:12px; line-height:18px; color:var(--sidebar-foreground); }
.sv4 .sv-recent-heading { margin:22px 8px 6px; font-size:11px; color:var(--sidebar-foreground); }
.sv4 .sv-recent { padding-left:8px; }
.sv4 .sv-recent-path { font-size:11px; color:var(--sidebar-foreground); white-space:nowrap; }
.sv-popover { width:min(320px,calc(100vw - 24px)); }
.sv-popover [data-slot=empty] { padding:28px 16px; }
.sv-popover-footer { margin-top:12px; }
@container sv4 (max-width:280px) {
 .sv4 .sv-worktree-group { --sv-step:8px; }
 .sv4 .sv-worktree { column-gap:4px; }
 .sv4 .sv-worktree[data-main=false] .sv-summary-full { display:none; }
 .sv4 .sv-worktree[data-main=false] .sv-summary-count { display:inline; }
}
@container sv4 (max-width:240px) {
 .sv4 .sv-worktree { grid-template-columns:var(--sv-icon) minmax(0,1fr) var(--sv-status); }
 .sv4 .sv-worktree .sv-summary { display:none; }
 .sv4 .sv-worktree .sv-state { grid-column:3; }
 .sv4 .sv-window-label { max-width:72px; }
}
@container sv4 (min-width:300px) {
 .sv4 .sv-window-label { max-width:140px; }
}
@media (prefers-reduced-motion:reduce) { .sv4 * { transition:none; animation:none; } }
`;
