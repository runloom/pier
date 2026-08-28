# Smoke canvases

Minimal entries that only prove: compile → `pier-live://` → mount. These are
disk fixtures for `tests/unit/main/live-modules/` (frameworks/service) — keep
them in sync with those tests; do not add demos here.

| File | Framework |
|------|-----------|
| `hello.canvas.tsx` | React + `pier/canvas` |
| `hello.canvas.vue` | Vue 3（需 `vue` + `@vue/compiler-sfc`） |
| `hello.canvas.solid.tsx` | Solid（需 `solid-js`） |
| `hello.canvas.svelte` | Svelte 5（需 `svelte`） |
| `scoped-style.canvas.vue` | Vue scoped style 编译面 |

Product shapes → `resources/system-skills/pier-canvas/templates/`.

**Non-React:** use host `pier-c-*` shell classes (not `pier/canvas` — React-only). See parent [README](../README.md).
