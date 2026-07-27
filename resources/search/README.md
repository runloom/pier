# Content search runtime

Pier content search (`FileQueryService` content mode) resolves an application-owned
`rg` binary here. Layout:

```text
resources/search/<arch>/rg
```

- `<arch>` is `arm64` or `x64` (Intel macOS / Linux x64 maps to `x64`).
- The binary must be executable; packaging unpacks it outside asar when needed.
- Resolution never falls back to the user `PATH` by default (see
  `docs/superpowers/specs/2026-07-27-files-content-search-design.md` §5.1).

Fetch both macOS arches:

```bash
node scripts/fetch-file-search-runtime.mjs
# CI / release: fail if either arch is missing
REQUIRE_DUAL_ARCH=1 node scripts/fetch-file-search-runtime.mjs
```

Missing binaries cause content queries to fail with `search-runtime-unavailable`.

Diagnostics-only override (dev): `PIER_RG_PATH=/absolute/path/to/rg`.
