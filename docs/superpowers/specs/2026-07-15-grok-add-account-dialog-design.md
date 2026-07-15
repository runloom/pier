# Grok Add Account Dialog + Nested ESC

Date: 2026-07-15  
Status: partially superseded  
Ownership note: nested plugin Dialog ownership is superseded by
`docs/superpowers/specs/2026-07-15-host-content-dialog-architecture-design.md`.
Product UX decisions below (two tabs, footer actions, waiting rules) remain valid.

## Goals

1. Nested modal ESC closes only the topmost dialog/alert.
2. Grok “Add account” uses a two-tab auth UX aligned with industry practice and Pier/shadcn primitives.
3. Remove fake multi-select `Button` lists and redundant “select mode then Continue” for OIDC.

## Nested ESC

### Problem

Settings is a parent `Dialog`. Add-account is a nested `Dialog`. Radix layers each handle Escape, so one keypress closes every open modal.

### Decision

Own the behavior in `@pier/ui`:

- Shared helper identifies open modal shells: `[data-slot=dialog-content]`, `[data-slot=alert-dialog-content]`.
- Topmost = last matching node in document order (portals append later).
- `DialogContent` / `AlertDialogContent` `onEscapeKeyDown`:
  - if current content is not topmost → `preventDefault()` and return
  - else run caller `onEscapeKeyDown` (e.g. waiting login still blocks close)
- Product code does not special-case nested stacks.

### Acceptance

- Settings open → add dialog open → Esc closes only add dialog.
- Second Esc closes settings (subject to settings blur-save behavior).
- Waiting login still ignores Esc at the top layer.

## Add Grok account dialog

### Decision: two tabs (not three)

| Tab | Content |
|---|---|
| Account login (default) | Recommended browser OAuth primary CTA; device code as secondary outline action |
| API key | `Field` form + footer “Add API key” |

Rationale:

- OAuth and device code are the same account class (OIDC via Grok CLI); splitting them into peer tabs is wrong hierarchy.
- API key is a different credential mental model → own tab (common Account | API key pattern).
- Three tabs (`OAuth | Device | API key`) overcrowds a narrow dialog and collides with waiting state.

### States

1. **Choose**
   - Header title/description for add account
   - Trust `Item variant="muted"`
   - `Tabs`: Account login | API key
   - Account tab: description + primary “Continue in browser” + secondary “Use device code”
   - API key tab: password field, optional label, description; footer Cancel + Add API key
   - Account tab footer: Cancel only (primary actions live in tab body)

2. **Waiting** (after OIDC start)
   - Hide tabs
   - Spinner status item
   - Footer: Cancel login + Reopen browser
   - Esc does not close

### Components

- `Dialog` / `DialogTrigger` / `DialogContent` / `DialogFooter`
- `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent`
- `Item` for trust + waiting
- `FieldSet` / `Field` / `Input` for API key
- No stacked `Button` + `aria-pressed` mode list

### i18n

Keep existing keys where possible; add:

- `addDialogTabAccount` / `addDialogTabApiKey`
- `addDialogAccountDescription`
- `addDialogOtherMethods` (section label above device code)
- Prefer user-facing “Continue in browser” over bare “Continue”
- Device CTA: “Use device code”

### Out of scope

- Changing Codex single-path OAuth dialog layout (except it benefits from host ESC stack fix)
- Peer sync / quota behavior

## Verification

- Unit: nested ESC only closes topmost
- Unit: Grok settings can add API key via API key tab
- Unit: Grok account tab starts OIDC oauth / device
- Rebuild `@pier/plugin-grok`
