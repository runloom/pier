# Pier Minimal Vector App Icon Design

## Status

Approved direction from the user on 2026-08-28. This specification supersedes
the PNG-first artwork decision for the app icon while preserving its generated
platform containers.

## Goal

Use one precise vector mark — terminal prompt `>_` plus the lower blue berth —
as Pier's app identity. Geometry must never drift between previews, Dock assets,
or platform exports.

## Canonical geometry

The authored source is `build/app-icon-source.svg` with
`viewBox="0 0 1024 1024"`. The body is a full-bleed square
`x=0`, `y=0`, `width=1024`, `height=1024` with no baked corner radius and no
inset transform. The operating system owns the Dock / launcher silhouette.
Artwork lives in the same 1024-unit space:

- Chevron centerline: `M337 223 L522 405 L337 599`, round cap/join,
  `stroke-width=104`.
- Underscore centerline: `M547 612 H770`, round cap, `stroke-width=80`.
- Chevron and underscore stay one `>_` lockup, optically centered in the dark
  basin above the berth:
  `translate(512 440) scale(0.86) translate(-547.5 -411.5)`. Path data and
  stroke widths stay canonical. The lockup is centered in the dark well
  (horizontal and vertical), not parked in the upper half.
- Berth: `M0 664 H64 C176 664 180 850 320 850 H704 C844 850 848 664 960 664 H1024 V1024 H0 Z`.
- The berth touches both horizontal edges of the canvas and fills its
  bottom edge. It must never become a detached or rounded standalone U.

No alternate small, tiny, micro, Dock, or unplated SVG rendition is allowed.
Every target is a deterministic resize of the one master.

## Material and color

- Body: even matte graphite `#1e2430 → #141820 → #0c1016`. The chassis is not
  metal.
- The prompt `>_` is solid white `#ffffff`. It is the lamp, not the metal.
- The berth is brand-violet metal (`#b66cff → #8549ff → #542ee5`). Shoulder
  pings are large, quiet radial washes (`r=180`, peak opacity `0.22`) whose
  centers sit on the inner U, so clipping to the berth yields a semicircle,
  not a quarter-circle cut by the inner corner. An inset inner-U rim uses
  round caps and a vertical light-from-above gradient (peak opacity `0.32`
  at the waterline, `0.04` in the trough). Do not restore a horizontal
  endpoint-hot rim or ping peaks near white; those collapse into two Dock
  lamps.
- The berth path remains the canonical visible geometry. A same-fill overscan
  seam guard continues its otherwise hidden closing edge below the canvas
  (`viewBox 0 0 1024 1024`) before relief is evaluated, preventing that
  implementation-only edge from becoming a dark line at the bottom of the icon.
- Brand and body gradients use the shared `0% / 46% / 100%` stop positions.
  Ping and rim highlights may use extra stops.
- Micro-bevel applies to the berth only. The white prompt is a hard-edged lamp.
  Metal shine on the berth is one continuous inner-U lip plus the quiet
  shoulder washes. At 32–64 px it must read as a single metal edge, not two
  isolated highlights.
- The shared relief is a strictly internal micro-bevel. It subtracts a shifted
  `SourceAlpha` from the original alpha to derive a top facet (`blur=1.25`,
  `dy=6`, `opacity=.28`) and a lower facet (`blur=1.75`, `dy=-8`,
  `opacity=.34`) in the 1024-unit source. Both tinted facets are composited into
  `SourceAlpha` again before merge, so no filtered pixel may cross the original
  artwork contour.
- Relief is micro-scale. At 32 px it may improve separation but must not become
  an independent one-pixel outline. No neon glow or colored bloom.
- Exterior drop shadow and the platform squircle belong to the operating
  system. The SVG is full-bleed and unmasked. Do not bake a rounded container,
  transparent safe area, or inner edge rim: on macOS 26 those become a second
  plate around the mark.
- No exterior glow, outer stroke, or `feDropShadow`.

## Build and platform routing

- `build/app-icon-source.svg` is the only authored application-icon source.
- electron-builder's pinned icons tool rasterizes the SVG at 1024 px and uses
  Lanczos resizing for ICNS, ICO, and Linux PNGs.
- The generated ICNS 1024 frame is extracted to a temporary RGBA PNG for a
  one-layer Icon Composer document. The PNG is the full-bleed composite:
  colors and micro-relief are already resolved; native shadow, specular,
  translucency, and glass effects remain disabled so macOS does not wrap a
  second material around the mark. The temporary PNG/document is never
  published as another source.
- Generated committed assets remain: `icon.icns`, `icon.ico`, `icon.png`, the
  eight existing `build/icons/*` PNGs, `Assets.car`, and `Assets.car.inputs`.
- `Assets.car.inputs` fingerprints the authored SVG, the actual extracted ICNS
  1024px PNG bytes, and the fixed renderer/actool contract. PierDev derives the
  same PNG from `build/icon.icns` and refuses installation when this sidecar
  does not match, preventing `pnpm dev` from silently showing stale art or a
  CAR whose pixels differ from ICNS.
- `pnpm dev` installs `build/icon.icns` into PierDev.app and every Helper. It
  removes stale `Assets.car` files and `CFBundleIconName` keys so neither path
  adds another compiled material pass. A valid three-component
  `CFBundleVersion` includes the icon revision in its final component before
  Launch Services re-registration.

## Verification

- SVG validation locks the viewBox, self-contained assets, canonical path data,
  and shared material parameters.
- The 1024 ICNS frame and temporary Icon Composer PNG must be byte-identical.
- At 16 px, the chevron remains at least 2×3 visible pixels. The underscore
  may drop out at this size (Terminal.app does the same). The berth remains
  continuous with at least two visible center rows.
- Black, neutral Dock gray, and white compositing must show a pixel-sharp outer
  contour with no bright exterior halo or blurred shadow fringe.
- The design review page shows exactly one actual generated 512 px PNG. Native
  size comparisons remain internal verification evidence rather than visible
  design alternatives.
- The development bundle must install the regenerated ICNS and invalidate its
  icon cache when generated icon bytes change.
- The body is a tested full-bleed square with no radius, inset, or clip;
  rendered four-corner alpha must stay opaque at every generated size.
