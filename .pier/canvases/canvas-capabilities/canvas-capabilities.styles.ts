/**
 * 只属于本能力说明稿的高保真样式。
 *
 * 在 Live Modules 支持具备生命周期的 CSS 产物前，暂以 TypeScript 字符串承载；
 * 原生 @scope 在维持单产物编译的同时，避免选择器影响宿主或其他 Canvas。
 */
export const CANVAS_CAPABILITIES_STYLES = `
@scope ([data-canvas-capabilities]) {
  :scope {
    --cc-grid: color-mix(in srgb, var(--border) 42%, transparent);
    display: flex;
    min-height: 720px;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--background);
    color: var(--foreground);
    box-shadow: 0 18px 50px color-mix(in srgb, var(--foreground) 8%, transparent);
  }

  :scope * { box-sizing: border-box; }
  :scope button { font: inherit; }

  :scope code,
  :scope .cc-kicker,
  :scope .cc-nav__key,
  :scope .cc-question,
  :scope .cc-panel__eyebrow,
  :scope .cc-level__index,
  :scope .cc-route-footer {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .cc-header {
    display: flex;
    min-height: 54px;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--card);
  }

  .cc-header > [data-slot="separator"] { height: 24px; }
  .cc-brand, .cc-heading, .cc-heading__meta, .cc-nav {
    display: flex;
    align-items: center;
  }
  .cc-brand { gap: 8px; }

  .cc-brand__mark {
    display: grid;
    width: 22px;
    height: 22px;
    grid-template-columns: repeat(3, 1fr);
    align-items: end;
    gap: 2px;
    padding: 4px;
    border-radius: 5px;
    background: var(--action-accent);
  }
  .cc-brand__mark span {
    display: block;
    border-radius: 1px;
    background: var(--action-accent-foreground);
  }
  .cc-brand__mark span:nth-child(1) { height: 45%; }
  .cc-brand__mark span:nth-child(2) { height: 85%; }
  .cc-brand__mark span:nth-child(3) { height: 64%; }

  .cc-kicker {
    color: var(--muted-foreground);
    font-size: 10px;
    letter-spacing: .12em;
  }
  .cc-heading { min-width: 0; gap: 10px; }
  .cc-heading h1 {
    overflow: hidden;
    max-width: 240px;
    font-size: 14px !important;
    font-weight: 600 !important;
    line-height: 1 !important;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc-heading__meta { gap: 5px; }
  .cc-nav {
    margin-left: auto;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--muted);
  }
  .cc-nav__key { color: var(--muted-foreground); font-size: 9px; }

  .cc-question {
    display: flex;
    min-height: 28px;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border-bottom: 1px solid var(--border);
    color: var(--muted-foreground);
    background: var(--muted);
    font-size: 10px;
  }
  .cc-question strong {
    color: var(--foreground);
    font-family: var(--font-sans, sans-serif);
    font-size: 11px;
    font-weight: 500;
  }
  .cc-question__tail {
    overflow: hidden;
    margin-left: auto;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cc-surface-panel {
    display: flex;
    min-height: 0;
    flex: 1;
  }
  .cc-surface-panel[hidden],
  [role="tabpanel"][hidden] { display: none; }

  .cc-surface {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    background-color: var(--background);
    background-image:
      linear-gradient(var(--cc-grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--cc-grid) 1px, transparent 1px);
    background-size: 24px 24px;
  }

  .cc-view-switch {
    display: flex;
    min-height: 36px;
    align-items: center;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--card);
  }
  .cc-view-switch > span {
    margin-left: auto;
    padding-right: 8px;
    color: var(--muted-foreground);
    font-size: 10px;
  }

  .cc-panel {
    min-width: 0;
    border-color: var(--border);
    background: var(--card);
  }
  .cc-panel [data-slot="card-header"] { gap: 6px; padding: 13px 14px 10px; }
  .cc-panel [data-slot="card-content"] { padding: 0 14px 14px; }
  .cc-panel [data-slot="card-title"] { font-size: 14px; }
  .cc-panel [data-slot="card-description"] { font-size: 11px; line-height: 1.55; }
  .cc-panel__eyebrow {
    display: flex;
    min-height: 20px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--muted-foreground);
    font-size: 9px;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .cc-overview-hero {
    overflow: hidden;
    border-color: var(--status-info-border);
    background:
      linear-gradient(
        110deg,
        var(--status-info-bg),
        color-mix(in srgb, var(--card) 94%, transparent) 58%
      );
  }
  .cc-overview-hero [data-slot="card-title"] {
    max-width: 680px;
    font-size: 18px;
    letter-spacing: -.015em;
  }
  .cc-overview-hero [data-slot="card-description"] { max-width: 780px; }
  .cc-overview-progress {
    display: grid;
    grid-template-columns: minmax(180px, .38fr) minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    color: var(--muted-foreground);
    font-size: 10px;
  }
  .cc-overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(280px, .55fr);
    gap: 10px;
  }
  .cc-overview-side { display: grid; align-content: start; gap: 10px; }
  .cc-capability-map {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  .cc-capability-map article {
    min-width: 0;
    padding: 9px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    background: var(--muted);
  }
  .cc-capability-map article:nth-child(2n) { border-right: 0; }
  .cc-capability-map article:nth-last-child(-n+2) { border-bottom: 0; }
  .cc-capability-map article > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cc-capability-map strong { font-size: 10px; }
  .cc-capability-map p {
    margin: 5px 0 0;
    color: var(--muted-foreground);
    font-size: 9px;
    line-height: 1.45;
  }
  .cc-reading-order {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cc-reading-order li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    align-items: center;
    gap: 7px;
    color: var(--muted-foreground);
    font-size: 9px;
  }
  .cc-reading-order span {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--foreground);
    background: var(--muted);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 8px;
  }

  .cc-product-flow {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  .cc-product-flow article {
    position: relative;
    min-height: 100px;
    padding: 11px;
    border-right: 1px solid var(--border);
    background: var(--muted);
  }
  .cc-product-flow article:last-child { border-right: 0; }
  .cc-product-flow article > span {
    display: block;
    margin-bottom: 12px;
    color: var(--action-accent);
    font-family: var(--font-mono, monospace);
    font-size: 9px;
  }
  .cc-product-flow strong { font-size: 12px; }
  .cc-product-flow p,
  .cc-system-list p,
  .cc-tech-flow p,
  .cc-ban-list p {
    margin: 5px 0 0;
    color: var(--muted-foreground);
    font-size: 10px;
    line-height: 1.45;
  }

  .cc-capability-grid {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1.45fr) minmax(300px, .55fr);
    gap: 10px;
  }
  .cc-mermaid-workbench {
    display: grid;
    min-height: 270px;
    grid-template-columns: minmax(230px, .72fr) minmax(0, 1.28fr);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--muted);
  }
  .cc-mermaid-source {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-right: 1px solid var(--border);
  }
  .cc-mermaid-source > span {
    color: var(--muted-foreground);
    font-family: var(--font-mono, monospace);
    font-size: 8px;
    letter-spacing: .08em;
  }
  .cc-mermaid-source [data-slot="textarea"] {
    min-height: 232px;
    flex: 1;
    resize: none;
    border: 0;
    background: var(--background);
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    line-height: 1.55;
    box-shadow: none;
  }
  .cc-mermaid-preview {
    min-height: 270px;
    border: 0 !important;
    border-radius: 0 !important;
    background: var(--background) !important;
  }
  .cc-product-evidence {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(320px, .7fr);
    gap: 10px;
  }
  .cc-family-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  .cc-family-grid article {
    min-width: 0;
    padding: 9px;
    border-bottom: 1px solid var(--border);
    background: var(--muted);
  }
  .cc-family-grid article:nth-child(odd) { border-right: 1px solid var(--border); }
  .cc-family-grid article:nth-last-child(-n+2) { border-bottom: 0; }
  .cc-family-grid article > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cc-family-grid strong { font-size: 10px; }
  .cc-family-grid code { color: var(--action-accent); font-size: 8px; }
  .cc-family-grid p {
    margin: 5px 0 2px;
    color: var(--foreground);
    font-size: 9px;
  }
  .cc-family-grid small { color: var(--muted-foreground); font-size: 8px; }
  .cc-chart-toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-bottom: 6px;
  }
  .cc-chart-toolbar > span {
    margin-left: auto;
    color: var(--muted-foreground);
    font-size: 10px;
  }
  .cc-chart-toolbar strong { color: var(--foreground); font-weight: 500; }

  .cc-system-list { display: grid; gap: 7px; }
  .cc-system-list article {
    padding: 8px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--muted);
  }
  .cc-system-list article > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cc-system-list code { color: var(--foreground); font-size: 11px; }

  .cc-freedom-stack { display: grid; gap: 10px; }
  .cc-viewport-toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-bottom: 7px;
  }
  .cc-viewport-toolbar > span {
    overflow: hidden;
    margin-left: auto;
    color: var(--muted-foreground);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc-shell-preview {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--background);
  }
  .cc-shell-chrome {
    display: grid;
    min-height: 32px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--muted);
  }
  .cc-shell-chrome code { color: var(--action-accent); font-size: 8px; }
  .cc-shell-chrome > span {
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc-shell-stage {
    display: grid;
    min-height: 210px;
    grid-template-columns: minmax(0, 1fr) 138px;
    gap: 8px;
    padding: 8px;
    background-image:
      linear-gradient(var(--cc-grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--cc-grid) 1px, transparent 1px);
    background-size: 16px 16px;
  }
  .cc-free-canvas {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 194px;
    flex-direction: column;
    gap: 9px;
    justify-self: center;
    padding: 12px;
    border: 1px solid var(--ring);
    border-radius: 6px;
    background: var(--card);
    box-shadow: 0 10px 30px color-mix(in srgb, var(--foreground) 7%, transparent);
    transition: width 180ms ease, border-radius 180ms ease;
  }
  .cc-shell-preview[data-viewport="document"] .cc-free-canvas { width: 62%; }
  .cc-shell-preview[data-viewport="workspace"] .cc-free-canvas { width: 88%; }
  .cc-shell-preview[data-viewport="full-bleed"] .cc-free-canvas {
    width: 100%;
    border-radius: 2px;
  }
  .cc-free-canvas > div:first-child {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cc-free-canvas > div:first-child > span {
    color: var(--muted-foreground);
    font-family: var(--font-mono, monospace);
    font-size: 8px;
    letter-spacing: .08em;
  }
  .cc-free-canvas > strong { max-width: 360px; font-size: 13px; line-height: 1.35; }
  .cc-free-composition {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .cc-free-composition span {
    display: grid;
    min-height: 46px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--muted-foreground);
    background: var(--muted);
    font-size: 9px;
  }
  .cc-bridge-rail {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card);
  }
  .cc-bridge-rail > span {
    color: var(--muted-foreground);
    font-size: 8px;
  }
  .cc-bridge-rail code {
    overflow: hidden;
    padding: 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--action-accent);
    background: var(--muted);
    font-size: 8px;
    text-overflow: ellipsis;
  }
  .cc-boundary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .cc-boundary-list,
  .cc-bridge-list { display: grid; gap: 6px; }
  .cc-boundary-list article,
  .cc-bridge-list article {
    display: grid;
    min-height: 42px;
    align-items: center;
    gap: 5px 8px;
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--muted);
  }
  .cc-boundary-list article { grid-template-columns: 64px minmax(0, 1fr); }
  .cc-boundary-list strong,
  .cc-bridge-list strong { font-size: 9px; }
  .cc-boundary-list small,
  .cc-bridge-list small { color: var(--muted-foreground); font-size: 8px; line-height: 1.4; }
  .cc-bridge-list article {
    grid-template-columns: 48px minmax(0, 1fr) auto;
  }
  .cc-bridge-list code {
    overflow: hidden;
    color: var(--action-accent);
    font-size: 8px;
    text-overflow: ellipsis;
  }
  .cc-trust-flow {
    display: grid;
    grid-template-columns: repeat(7, auto);
    align-items: center;
    justify-content: start;
    gap: 7px;
  }
  .cc-trust-flow span {
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--muted);
    font-size: 9px;
  }
  .cc-trust-flow b {
    color: var(--action-accent);
    font-size: 10px;
    font-weight: 500;
  }

  .cc-tech-grid {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1.1fr) minmax(320px, .9fr);
    gap: 10px;
  }
  .cc-tech-flow-card { grid-row: span 2; }
  .cc-tech-flow { display: grid; gap: 7px; }
  .cc-tech-flow > span {
    height: 12px;
    padding-left: 20px;
    color: var(--action-accent);
    font-size: 11px;
  }
  .cc-tech-flow article {
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--muted);
  }
  .cc-tech-flow article > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .cc-tech-flow strong { font-size: 11px; }
  .cc-tech-flow code { color: var(--action-accent); font-size: 9px; }

  .cc-owner-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .cc-owner-grid div {
    display: flex;
    min-height: 52px;
    flex-direction: column;
    justify-content: center;
    padding: 8px 9px;
    border-bottom: 1px solid var(--border);
  }
  .cc-owner-grid div:nth-child(odd) { border-right: 1px solid var(--border); }
  .cc-owner-grid div:nth-last-child(-n+2) { border-bottom: 0; }
  .cc-owner-grid span { color: var(--muted-foreground); font-size: 9px; }
  .cc-owner-grid strong {
    margin-top: 3px;
    font-size: 10px;
    font-weight: 500;
    line-height: 1.4;
  }
  .cc-panel [data-slot="separator"] { margin: 10px 0; }

  .cc-ban-list {
    display: grid;
    grid-template-columns: 36px repeat(2, minmax(0, 1fr));
    gap: 5px 8px;
  }
  .cc-ban-list > span {
    grid-row: span 2;
    color: var(--status-warning-fg);
    font-size: 9px;
  }
  .cc-ban-list p { margin: 0; color: var(--foreground); }

  .cc-frameworks {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
  }
  .cc-frameworks article {
    display: flex;
    min-width: 0;
    min-height: 68px;
    flex-direction: column;
    gap: 5px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--muted);
  }
  .cc-frameworks strong { font-size: 11px; }
  .cc-frameworks code,
  .cc-frameworks small { overflow: hidden; font-size: 9px; text-overflow: ellipsis; }
  .cc-frameworks small { color: var(--muted-foreground); }

  .cc-skill-grid {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .cc-skill-flow { display: grid; gap: 7px; }
  .cc-skill-flow article {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--muted);
  }
  .cc-skill-flow article > span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--action-accent);
    font-family: var(--font-mono, monospace);
    font-size: 9px;
  }
  .cc-skill-flow article > div { display: flex; flex-direction: column; gap: 2px; }
  .cc-skill-flow strong { font-size: 11px; }
  .cc-skill-flow small { color: var(--muted-foreground); font-size: 9px; }

  .cc-skill-io {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .cc-skill-io div { padding: 9px; border-bottom: 1px solid var(--border); }
  .cc-skill-io div:nth-child(odd) { border-right: 1px solid var(--border); }
  .cc-skill-io div:nth-last-child(-n+2) { border-bottom: 0; }
  .cc-skill-io dt { color: var(--muted-foreground); font-size: 9px; }
  .cc-skill-io dd {
    margin: 4px 0 0;
    font-size: 10px;
    line-height: 1.45;
  }
  .cc-skill-rules { display: grid; gap: 6px; }
  .cc-rule {
    display: grid;
    grid-template-columns: 50px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--muted);
    font-size: 10px;
  }

  .cc-verification-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  .cc-verification-grid > article {
    min-width: 0;
    padding: 10px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    background: var(--muted);
  }
  .cc-verification-grid > article:nth-child(2n) { border-right: 0; }
  .cc-verification-grid > article:nth-last-child(-n+2) { border-bottom: 0; }
  .cc-verification-item__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cc-verification-item__header strong { font-size: 10px; }
  .cc-verification-grid p {
    margin: 6px 0;
    color: var(--foreground);
    font-size: 9px;
    line-height: 1.45;
  }
  .cc-verification-grid dl { display: grid; gap: 3px; margin: 0 0 7px; }
  .cc-verification-grid dl > div {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 5px;
    font-size: 8px;
    line-height: 1.4;
  }
  .cc-verification-grid dt { color: var(--muted-foreground); }
  .cc-verification-grid dd { margin: 0; color: var(--muted-foreground); }
  .cc-verification-grid code {
    display: block;
    overflow: hidden;
    color: var(--action-accent);
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cc-interaction-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.12fr) minmax(320px, .88fr);
    gap: 10px;
  }
  .cc-levels { display: grid; gap: 8px; }
  .cc-level {
    display: grid;
    min-width: 0;
    grid-template-columns: 38px minmax(0, 1fr) 20px;
    align-items: center;
    gap: 10px;
    min-height: 74px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--foreground);
    background: var(--card);
    text-align: left;
    transition: border-color 140ms ease, transform 140ms ease;
  }
  .cc-level:hover, .cc-level[aria-pressed="true"] { border-color: var(--ring); }
  .cc-level:hover { transform: translateX(2px); }
  .cc-level[aria-pressed="true"] { box-shadow: inset 3px 0 0 var(--ring); }
  .cc-level__index {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--muted-foreground);
    background: var(--muted);
    font-size: 10px;
  }
  .cc-level__copy { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
  .cc-level__copy > span { display: flex; align-items: center; gap: 7px; }
  .cc-level__copy strong { font-size: 12px; }
  .cc-level__copy small,
  .cc-check small { color: var(--muted-foreground); font-size: 10px; line-height: 1.4; }
  .cc-level__arrow { color: var(--muted-foreground); }

  .cc-checks {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .cc-check {
    display: flex;
    min-width: 0;
    min-height: 68px;
    align-items: flex-start;
    gap: 8px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--foreground);
    background: var(--muted);
    text-align: left;
  }
  .cc-check[aria-pressed="true"] {
    border-color: var(--status-success-border);
    background: var(--status-success-bg);
  }
  .cc-check__box {
    display: grid;
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--status-success-fg);
    font-size: 10px;
  }
  .cc-check > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
  .cc-check strong { font-size: 11px; }
  .cc-progress {
    display: grid;
    grid-template-columns: minmax(120px, .45fr) minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    margin-top: 10px;
    color: var(--muted-foreground);
    font-size: 10px;
  }

  .cc-route-grid {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1fr) 330px;
    gap: 10px;
  }
  .cc-task-graph {
    position: relative;
    height: 438px;
  }
  .cc-task-graph [data-slot="node-graph"] { height: 100%; }
  .cc-task-graph__diagnostic {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    margin: 0;
    border-top: 1px solid var(--status-danger-border);
    background: var(--status-danger-bg);
    color: var(--status-danger-fg);
    padding: 8px 12px;
    font-size: 10px;
  }
  .cc-task-panel [data-slot="card-content"] {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .cc-evidence { display: flex; flex-direction: column; gap: 7px; }
  .cc-evidence > span,
  .cc-todo-header span { color: var(--muted-foreground); font-size: 9px; }
  .cc-evidence ol {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cc-evidence li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: 7px;
    min-height: 34px;
    padding: 6px 7px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--muted);
    font-size: 10px;
    line-height: 1.35;
  }
  .cc-evidence li span {
    color: var(--muted-foreground);
    font-family: var(--font-mono, monospace);
  }
  .cc-todo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .cc-todo-header strong { font-size: 9px; }
  .cc-todos {
    display: grid;
    max-height: 244px;
    gap: 4px;
    overflow-y: auto;
  }
  .cc-todo-row {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    min-height: 30px;
    align-items: center;
    gap: 5px;
    padding: 3px 6px;
    border: 1px solid transparent;
    border-radius: 5px;
  }
  .cc-todo-row[data-selected="true"] {
    border-color: var(--border);
    background: var(--muted);
  }
  .cc-todo-row > button {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    color: var(--foreground);
    background: transparent;
    text-align: left;
  }
  .cc-todo-row code { color: var(--muted-foreground); font-size: 9px; }
  .cc-todo-row button span { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .cc-todo-row small { color: var(--muted-foreground); font-size: 8px; }

  .cc-route-footer {
    display: grid;
    min-height: 34px;
    grid-template-columns: minmax(160px, .35fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted-foreground);
    background: var(--card);
    font-size: 9px;
  }
  .cc-route-footer strong {
    justify-self: end;
    color: var(--foreground);
    font-family: var(--font-sans, sans-serif);
    font-size: 10px;
    font-weight: 500;
  }

  @media (max-width: 1120px) {
    .cc-heading__meta { display: none; }
  }

  @media (max-width: 940px) {
    .cc-heading__meta, .cc-kicker, .cc-question__tail { display: none; }
    .cc-capability-grid,
    .cc-boundary-grid,
    .cc-overview-grid,
    .cc-product-evidence,
    .cc-tech-grid,
    .cc-skill-grid,
    .cc-interaction-grid,
    .cc-route-grid { grid-template-columns: 1fr; }
    .cc-tech-flow-card { grid-row: auto; }
    .cc-product-flow, .cc-checks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cc-product-flow article:nth-child(2) { border-right: 0; }
    .cc-product-flow article:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
    .cc-task-graph { height: 360px; }
  }

  @media (max-width: 620px) {
    :scope { min-height: 780px; }
    .cc-header { align-items: flex-start; flex-wrap: wrap; }
    .cc-header > [data-slot="separator"] { display: none; }
    .cc-heading { flex: 1; }
    .cc-nav { width: 100%; order: 3; }
    .cc-nav > button { flex: 1; }
    .cc-view-switch { align-items: stretch; flex-wrap: wrap; }
    .cc-view-switch > button { flex: 1; }
    .cc-view-switch > span { display: none; }
    .cc-product-flow,
    .cc-capability-map,
    .cc-checks,
    .cc-mermaid-workbench,
    .cc-family-grid,
    .cc-frameworks,
    .cc-owner-grid,
    .cc-skill-io,
    .cc-verification-grid { grid-template-columns: 1fr; }
    .cc-product-flow article,
    .cc-product-flow article:nth-child(2),
    .cc-capability-map article,
    .cc-capability-map article:nth-child(2n),
    .cc-family-grid article:nth-child(odd),
    .cc-owner-grid div:nth-child(odd),
    .cc-skill-io div:nth-child(odd),
    .cc-verification-grid > article,
    .cc-verification-grid > article:nth-child(2n) { border-right: 0; }
    .cc-product-flow article,
    .cc-capability-map article,
    .cc-capability-map article:nth-last-child(-n+2),
    .cc-family-grid article,
    .cc-family-grid article:nth-last-child(-n+2),
    .cc-owner-grid div,
    .cc-owner-grid div:nth-last-child(-n+2),
    .cc-skill-io div,
    .cc-skill-io div:nth-last-child(-n+2),
    .cc-verification-grid > article,
    .cc-verification-grid > article:nth-last-child(-n+2) { border-bottom: 1px solid var(--border); }
    .cc-product-flow article:last-child,
    .cc-capability-map article:last-child,
    .cc-family-grid article:last-child,
    .cc-owner-grid div:last-child,
    .cc-skill-io div:last-child,
    .cc-verification-grid > article:last-child { border-bottom: 0; }
    .cc-overview-progress { grid-template-columns: 1fr; }
    .cc-chart-toolbar { flex-wrap: wrap; }
    .cc-viewport-toolbar { align-items: stretch; flex-wrap: wrap; }
    .cc-viewport-toolbar > span { width: 100%; margin-left: 0; }
    .cc-shell-stage { grid-template-columns: 1fr; }
    .cc-shell-preview[data-viewport] .cc-free-canvas { width: 100%; }
    .cc-bridge-rail {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .cc-bridge-rail > span { grid-column: 1 / -1; }
    .cc-trust-flow { display: flex; flex-wrap: wrap; }
    .cc-mermaid-source { border-right: 0; border-bottom: 1px solid var(--border); }
    .cc-chart-toolbar > span { width: 100%; margin-left: 0; }
    .cc-route-footer { grid-template-columns: 1fr auto; }
    .cc-route-footer strong { grid-column: 1 / -1; justify-self: start; }
  }

  @media (prefers-reduced-motion: reduce) {
    :scope * {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }

}
`;
