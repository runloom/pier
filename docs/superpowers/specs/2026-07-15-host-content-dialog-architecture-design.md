# Host Content Dialog Architecture

Date: 2026-07-15  
Status: approved for planning  
Decision: long-term option **A** — host-owned content dialog host  
Migration scope: **Codex + Grok together**

## 1. Context

Pier already owns simple host modals through `AppDialogHost` + `showAppAlert` /
`showAppConfirm` / `showAppChoice` / `showAppPrompt`. Plugins reach the same
surface via `context.dialogs.alert|confirm`.

Complex product flows still self-mount `@pier/ui/dialog`:

- `packages/plugin-codex/src/renderer/add-account-dialog.tsx`
- `packages/plugin-codex/src/renderer/switch-confirm-dialog.tsx`
- `packages/plugin-grok/src/renderer/add-account-dialog.tsx`
- `packages/plugin-grok/src/renderer/switch-confirm-dialog.tsx`

These run while the host Settings dialog is open. Plugins bundle their own
Radix FocusScope stack (React is shared; Radix / `@pier/ui` are not). Nested
plugin dialogs therefore fight the host modal trap:

- ESC can close multiple layers
- focus can be stolen (inputs appear dead)
- dynamic `modal` demotion remounts Settings (“re-open settings”)
- nesting portal / non-modal patches in `@pier/ui` are transitional hacks

This design replaces nested plugin product dialogs with a host-owned content
dialog stack. Nested UI patches are temporary only.

## 2. Goals

1. Host owns every product modal stack entry (alert/confirm **and** custom content).
2. Plugins never mount product `Dialog` / `AlertDialog` shells for user flows.
3. Add-account remains a second-layer dialog **visually**, without nested plugin Dialog ownership.
4. ESC closes only the top host dialog layer; Settings stays mounted.
5. Waiting OIDC login is non-dismissible except explicit cancel/reopen actions.
6. Codex and Grok migrate together so account UX stays aligned.
7. Transitional nested-dialog hacks in `@pier/ui` are deleted after migration.

## 3. Non-goals

- Rewriting Settings into a non-modal page (optional later, not required).
- Sharing full `@pier/ui` / Radix singletons with plugins in this change.
- Marketplace / third-party plugins (still out of policy).
- Changing account domain RPC, secrets, or peer-sync semantics.
- Replacing host Settings / workbench library shells (they remain host Dialogs).

## 4. Architecture

### 4.1 Ownership

```text
Host renderer
├── AppDialogHost            // alert | confirm | choice | prompt (existing)
├── AppContentDialogHost     // custom content stack (new)
│     store: app-content-dialog.store
│     render: app-content-dialog-host.tsx
└── Plugin API
      context.dialogs.alert / confirm          // existing
      context.dialogs.open / update / close    // new
```

Rules:

- Only host hosts render modal shells (`Dialog` / `AlertDialog` primitives).
- Plugin code supplies **content components + result contracts**, not shells.
- Simple text confirm/alert continues through `AppDialogHost`.
- Multi-control or multi-state UI goes through `AppContentDialogHost`.

### 4.2 Stack model

Content dialogs form a host-managed stack (array), not a single replace-only
slot:

- `open` pushes a layer (or replaces same `id` if already open).
- `close(id)` / ESC / overlay policy pops that layer.
- Topmost layer receives focus trap and ESC.
- Lower layers remain mounted but inert (pointer-events none + aria-hidden).
- Settings stays open underneath; it is not remounted.

Simple `AppDialogHost` requests remain single-slot and still dismiss previous
alert/confirm/prompt when a new one opens. Content dialog stack is independent
but visually above Settings; if both exist, content dialog is topmost.

### 4.3 Plugin API

Extend `ExternalRendererPluginContext.dialogs`:

```ts
type ContentDialogSize = "sm" | "default" | "lg";

interface ContentDialogOpenRequest<TResult = unknown> {
  /** Stable id for update/replace/close. Plugin-scoped by host. */
  id: string;
  title: string;
  description?: string;
  size?: ContentDialogSize;
  /** Default true. false blocks ESC/overlay dismiss (waiting login). */
  dismissible?: boolean;
  /** Default false. Overlay click never dismisses unless true and dismissible. */
  closeOnOverlayClick?: boolean;
  content: ComponentType<ContentDialogRenderProps<TResult>>;
}

interface ContentDialogRenderProps<TResult = unknown> {
  id: string;
  close: (result?: TResult | null) => void;
  setDismissible: (dismissible: boolean) => void;
  setTitle: (title: string) => void;
  setDescription: (description?: string) => void;
}

interface ContentDialogHandle<TResult = unknown> {
  id: string;
  /** Resolves with result on close; null if dismissed/cancelled. */
  result: Promise<TResult | null>;
  update(patch: {
    title?: string;
    description?: string;
    dismissible?: boolean;
    closeOnOverlayClick?: boolean;
  }): void;
  close(result?: TResult | null): void;
}

dialogs: {
  alert(...): Promise<void>;
  confirm(...): Promise<boolean>;
  open<TResult = unknown>(
    request: ContentDialogOpenRequest<TResult>
  ): ContentDialogHandle<TResult>;
  update(
    id: string,
    patch: {
      title?: string;
      description?: string;
      dismissible?: boolean;
      closeOnOverlayClick?: boolean;
    }
  ): void;
  close(id: string, result?: unknown): void;
}
```

Host implementation notes:

- `id` is namespaced as `${pluginId}:${request.id}` for external plugins.
- Builtin/host callers use bare ids.
- `open` returns a handle immediately; await `handle.result` for completion.
- Opening the same namespaced id replaces content/props and keeps the layer.

### 4.4 Host rendering contract

`AppContentDialogHost` renders one `Dialog` shell per stack entry (topmost modal
focus trap only; lower shells inert). Shell owns:

- title / description headers
- ESC policy from `dismissible`
- overlay policy from `closeOnOverlayClick && dismissible`
- size mapping
- focus restoration to previous layer or Settings

Content component owns:

- body controls (tabs, fields, checkboxes)
- footer actions (buttons)
- calling `close(result)` / `setDismissible(false)` during waiting states

Content components render inside a host-provided scope element that still allows
plugin CSS scoping attributes if the plugin wraps its tree with
`data-pier-*-scope`.

### 4.5 ESC / focus rules

1. Top content dialog dismissible → ESC closes it only.
2. Top content dialog non-dismissible → ESC ignored.
3. No content dialog → Settings ESC behavior unchanged.
4. Never dynamically flip Settings `modal` to work around nesting.
5. Never rely on plugin-local nested Dialog focus traps.

## 5. Product migrations

### 5.1 Add account (Codex + Grok)

Keep the approved UX:

**Grok**

- Tabs: Account login | API key
- Account tab: friendly copy only
- Footer (account): Cancel | Use device code | Continue in browser
- Footer (api key): Cancel | Add API key
- Waiting: spinner + Cancel login | Reopen browser; `dismissible:false`

**Codex**

- Single OAuth path (existing)
- Authorize → Continue in browser
- Waiting: Cancel login | Reopen browser; `dismissible:false`

Implementation shape:

- Settings page keeps a header `Add account` button.
- Button calls `context.dialogs.open({ id: "accounts.add", content: AddAccountContent, ... })`.
- `AddAccountContent` holds the former dialog body/footer logic (no `Dialog*` shell imports).

### 5.2 Switch / sync confirm (Codex + Grok)

`SwitchConfirmDialog` becomes content-dialog content:

- title/body from mode (`switch` | `sync`)
- peer checkboxes
- footer Cancel | Confirm/Sync
- returns `{ confirmed, syncTargets }` via `close(result)`

Widget picker and settings switch actions await that result, then invoke RPC.

### 5.3 Forbidden after migration

Plugin renderer product code MUST NOT import/mount:

- `@pier/ui/dialog.tsx` product shells (`Dialog`, `DialogContent`, `DialogTrigger`, …)
- `@pier/ui/alert-dialog.tsx` product shells

Allowed:

- `context.dialogs.*`
- non-modal primitives (Button, Tabs, Field, Item, Checkbox, …)

Governance test enforces this under `packages/plugin-*/src/renderer/**`.

## 6. Cleanup of transitional mistakes

Delete after Phase 2 migration is green:

- `DialogNestingContext` and nested portal-into-parent behavior in `@pier/ui/dialog`
- nested default `modal={false}` special case driven by nesting context
- any “demote host modal while nested open” experiments
- docs/tests that treat nested plugin Dialog as the permanent pattern

Keep permanent:

- topmost ESC helper for **host-owned** multi-layer shells if content dialog stack
  uses multiple host Dialog nodes
- deferred open for menu → dialog handoff
- `AppDialogHost` simple dialogs

Update earlier note in
`docs/superpowers/specs/2026-07-15-grok-add-account-dialog-design.md`:

- nested ESC/product UX goals remain valid
- nested plugin Dialog ownership is superseded by this architecture

## 7. Phased delivery

### Phase 1 — Host content dialog infrastructure

- Add `src/renderer/stores/app-content-dialog.store.ts`
- Add `src/renderer/components/common/app-content-dialog-host.tsx`
- Mount host next to `AppDialogHost`
- Extend `packages/plugin-api` dialogs types
- Wire builtin + external plugin contexts
- Unit tests: open/update/close, ESC, non-dismissible, replace same id, stack order

### Phase 2 — Migrate Codex + Grok account dialogs

- Convert add-account + switch-confirm for both plugins to content components
- Settings/widget callers use `context.dialogs.open`
- Keep UX contracts from current approved Grok two-tab footer design
- Plugin unit/component tests updated

### Phase 3 — Governance + delete nesting hacks

- Add governance test forbidding plugin product Dialog/AlertDialog shells
- Remove `@pier/ui` nested-dialog transition code
- Update AGENTS.md host dialog rules
- Full targeted regression for settings ESC + account flows

### Phase 4 — Optional later

- Share more UI runtime with official plugins (bundle size / consistency)
- Still forbid plugin-owned product modal shells

## 8. Verification

Must pass before claiming complete:

1. Settings open → Add account content dialog opens without remounting Settings.
2. Grok API key field accepts typing.
3. ESC closes add dialog only; second ESC closes Settings (when dismissible).
4. OIDC waiting ignores ESC; Cancel login works.
5. Switch/sync peer dialogs work from settings and widget for Codex and Grok.
6. Governance test fails if a plugin product Dialog is reintroduced.
7. Nested-dialog transition helpers removed and suite still green.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Content dialog API too narrow | Start with title/description/size/dismissible + free content component |
| Plugin CSS scope breaks when content moves host-side | Content root keeps plugin scope attribute wrapper |
| Dual hosts (alert vs content) confuse stacking | Document z-order: content stack above settings; simple alert/confirm still global single-slot and should not open under active content flows without explicit product decision |
| Large migration | Phase 1 infrastructure first; Phase 2 migrates both plugins in one PR series |

## 10. Decision log

- 2026-07-15: Choose host Content Dialog Host over shared Radix singleton or Settings non-modal rewrite.
- 2026-07-15: Migrate Codex and Grok together.
- 2026-07-15: Nested plugin Dialog patches are transitional only and scheduled for deletion.
