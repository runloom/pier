# Smoke canvases

Minimal entries that only prove: compile → `pier-live://` → mount.

| File | Framework |
|------|-----------|
| `hello.canvas.tsx` | React + `pier/canvas` |
| `hello.canvas.vue` | Vue 3（需 `vue` + `@vue/compiler-sfc`） |
| `hello.canvas.solid.tsx` | Solid（需 `solid-js`） |
| `hello.canvas.svelte` | Svelte 5（需 `svelte`） |

Product shapes → `../templates/`. Multi-file stress → `../stress/`.

**Non-React:** use host `pier-c-*` shell classes (not `pier/canvas` — React-only). See parent [README](../README.md).
