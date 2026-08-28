# Cross-repository icon completion plan

> Implementation target: `/Users/xyz/ABC/pier` and `/Users/xyz/ABC/pier-site`.

## Goal

Use `pier/build/app-icon-source.svg` as the approved visual source everywhere the Pier product is identified, while making stale or partially branded release artifacts fail before they ship.

## Pier host

1. Add regression tests proving a production package gives the main app and all four macOS Helper bundles the canonical generated ICNS.
2. Add an `afterPack` hook that installs that ICNS into every Helper, removes legacy Helper icon files, and removes `CFBundleIconName`/`Assets.car` from Helpers so only the main app owns the native layered catalog.
3. Extend the release verifier to reject any missing, stale, or ambiguously configured Helper icon.
4. Make every icon build compile a fresh `Assets.car`; the input fingerprint remains a freshness record, never a cache authorization.
5. Expand CI path filters so release workflow, package metadata, hook, and any restored alternate app-icon SVG all run the icon gate.

## Pier website

1. Replace `public/logo.svg` with the approved authored SVG.
2. Generate Header/Footer mark, SVG/PNG favicon, Apple Touch icon, and OG image from that one file.
3. Add a non-mutating Node test that regenerates into a temporary directory and byte-compares every committed public asset.
4. Add a post-build test proving Astro copied those assets and emitted all expected favicon/OG references.
5. Run the brand checks automatically from `check` and `build`, and document the source and regeneration command.

## Verification

- Observe each new regression test fail before implementation.
- Run the focused Pier icon/release tests, the full related icon suite, and host typecheck.
- Run website brand tests, Astro check, and production build.
- Compare the two canonical SVG files byte-for-byte.
- Inspect the 32 px favicon, 180 px Apple Touch icon, and 1200×630 OG image visually.
- Request independent final reviews for both repositories and resolve all material findings.
