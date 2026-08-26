# Plugin data on canvases

Host channels are generic. `.canvas.tsx` is the only assembly layer.
Do not invent domain components (`AccountsCard`, `UsageMeter`, `Kpi`) or a
`canvasWidgets` contribution point.

## Discover

```ts
const plugins = await host.invoke({ type: "plugin.list" })
const inspect = await host.invoke({ type: "plugin.inspect", id: "pier.codex" })
// inspect.manifest.dataProjections / canvasActions
```

## Read

```ts
const accounts = useHostSnapshot("plugin:pier.codex/accounts")
// accounts.data is unknown — narrow it locally for this canvas
```

`useHostSnapshot("plugin:<id>/<key>")` takes a watch lease so usage polling
keeps running while the canvas is mounted.

Do not add a fourth data hook. Keep `useActivityOverview`,
`useSystemResources`, and `useCostOverview` as host aggregates. Refresh cost
with `host.invoke({ type: "usageData.refresh" })`.

## Write (declared actions only)

```ts
await host.invoke({
  type: "pluginAction.invoke",
  payload: {
    pluginId: "pier.codex",
    key: "accounts.select",
    payload: { accountId },
  },
})
```

The `key` must appear in that plugin's `canvasActions`. Do not invent
`accounts.add` / `remove` / OAuth methods on the canvas.

## Add / remove / sign-in

```ts
await host.invoke({
  type: "settings.open",
  section: "plugin:pier.codex",
})
```

Never reproduce login waiting dialogs, API-key sheets, or peer-sync confirms
on a canvas.

## Compose at least two layouts

Same snapshot, different primitives — do not copy one plugin widget.

**Compact row:** `Item` + `Progress` + `DropdownMenu` to switch + `Button` to
open settings.

**Table:** `Table` rows for every account, `Badge` for the active one,
`formatPercent` / `formatRelativeTime` for quota and freshness.

`formatPercent` takes a 0–1 ratio. Projection quota `usedPercent` is 0–100 —
call `formatPercent(usedPercent / 100, locale)`. Clamp the `Progress` value
to `[0, 100]`; plugins may report values outside that range.

Empty and error states use `Empty` / `Alert`. Surface failed
`pluginAction.invoke` on that `Alert`; do not swallow the rejection.

Live composition: `.pier/canvases/workbench-examples/` — Codex uses compact
`Item` rows + `DropdownMenu`; Grok uses `Table`. Both read
`plugin:pier.codex/accounts` / `plugin:pier.grok/accounts`. Sign-in still
goes through `settings.open` with `section: "plugin:pier.codex"` or
`"plugin:pier.grok"`.

## Hard bans

- `window.pier`
- workbench modules / `workbenchWidgets` / `canvasWidgets`
- plugin `accounts-widget` source
- undeclared `pluginAction.invoke` keys
- official `templates/accounts.canvas.tsx` (do not add one)
