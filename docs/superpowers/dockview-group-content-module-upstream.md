# Upstream: dockview GroupContentModule / groupContentComponent

## Problem

Pier's files plugin needs a **group-scoped persistent content layer**: one shared file tree + editor chrome per dockview group, while tabs remain thin shells that only publish which file is active.

Dockview today owns the content container and swaps panel content DOM on tab changes (`onlyWhenVisible`). That forces either:

1. Putting heavy UI (file tree) inside every panel content → remount / scroll reset / flicker; or
2. Out-of-band DOM injection into `.dv-content-container` (Pier's current v1 `FilesGroupViewHost`).

Injection works but depends on internal class names and layout. Pier locks this with a sentinel component test until a first-class API exists.

## Proposal

Add a **group content module** parallel to existing group-level parts (e.g. header actions):

### Core

- `groupContentService` slot on the group model / module registry.
- Persistent layer rendered as a sibling (or underlay) of the panel content host inside the group's content container.
- Layer stays mounted for the group lifetime; visibility can track whether the active panel opts into the module.

### React (`dockview-react`)

- New optional prop on `DockviewReact` (name bikeshed):

```tsx
<DockviewReact
  groupContentComponent={FilesGroupContent}
  // ...existing props
/>
```

- Component receives group api / active panel identity, same bridging pattern as `groupHeaderActions` / left-right header controls.
- Contracts package exports the prop types and a stable panel-participation flag if needed (e.g. panel params `groupContent: 'files'`).

### Migration path for Pier

1. Land upstream API.
2. Swap `FilesGroupViewHost` implementation to the prop-based host (same `FilesGroupView` business component).
3. Delete DOM injection + sentinel test that asserts `.dv-content-container` survival.

## Why not panel-only content

File explorer UX requires the tree to remain stable while switching file tabs. Panel content lifecycle cannot express "render once per group".

## Ask

- Is a `groupContentComponent` React prop + core module the preferred extension point?
- Any constraints vs floating groups / maximized groups / serialization?

## Temporary workaround in Pier

`src/plugins/builtin/files/renderer/files-group-view-host.tsx` injects `[data-slot="pier-files-group-view"]` into `.dv-content-container`, gated by active panel component id `pier.files.filePanel`. Sentinel: `tests/component/files-file-panel.test.tsx` ("keeps the injected files group view node across thin panel tab switches").