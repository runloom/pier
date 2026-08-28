# Pier App Icon Gold Standard Design

> Superseded later on 2026-08-28 by the approved PNG-first single-source
> implementation. This document remains as historical design context.

## Status

Approved by the user on 2026-08-28. This specification replaces the legacy
"terminal window inside a U-shaped dock" icon system.

## Goal

Ship the approved text-free "berthing capsule" mark as one coherent Pier app
identity across the macOS Dock, Finder, Activity Monitor, Settings,
Windows taskbar, and Linux launchers, while keeping the prompt and berth curve
legible at 16 px.

## Canonical artwork

The approved source set is:

- `logo.svg`: master rendition for 256, 512, and 1024 px.
- `logo-small.svg`: optically adjusted rendition for 64 and 128 px.
- `logo-tiny.svg`: optically adjusted rendition for 16, 24, 32, and 48 px.

The repository copies these approved files into `build/` and treats those
copies as the canonical build inputs. Generated assets must be reproducible
from them; generated binaries are never edited by hand.

## Platform routing

| Surface | Source and behavior |
| --- | --- |
| macOS 26+ | `Assets.car` compiled from a 1024×1024 Icon Composer document with semantic layers and `CFBundleIconName=app-icon` |
| Older macOS | ICNS fallback: 16/32 tiny, 64/128 small, 256/512/1024 master |
| PierDev.app | The same canonical `icon.icns` and validated `Assets.car` used by production |
| macOS Dock | Bundle-owned icon only; no runtime `app.dock.setIcon` override |
| Windows/Linux/window icon | The approved complete composite with transparent outside corners; never the legacy unplated F mark |

The 24 and 48 px Windows/Linux renditions use `logo-tiny.svg`. Native-size
review showed that its simplified berth edge and heavier prompt remain clearer
than the small rendition throughout this range.

## macOS layered icon

Use two meaningful groups and three vector layers instead of flattening the
complete icon into one foreground bitmap or stripping a plate with string
replacements:

1. `harbor`: harbor/bay color surface plus the berth rim and depth;
2. `prompt`: terminal chevron and cursor foreground.

The harbor group contains separate `harbor` and `berth-rim` vectors so depth
remains semantic without asking Icon Composer to synthesize duplicate glass.

The sources must remain square and unmasked for Icon Composer. The system owns
the final platform mask and dynamic material response. The build must compile
the committed `.icon` document with Xcode `actool`, validate the compiled
rendition with `assetutil`, and record a freshness fingerprint that covers the
document, compiler contract, and source layers.

## Small-icon legibility

Small sizes are separate optical renditions, not resized master art.

- 16, 24, 32, and 48 px use the tiny source with simplified material and enlarged prompt.
- 64 and 128 px use the small source with stronger edges and reduced grain.
- 256 px and larger restore the full master material.
- At 16 px, the solid icon body is centered at 14×14 px with no opaque edge
  pixel; anti-aliasing may touch the canvas edge only up to alpha 160.
- At 16 px, the chevron remains at least 4×5 visible pixels, the cursor remains
  at least 3×1 visible pixels, and a dark separation remains between the prompt
  and berth curve.
- At every target size, the berth curve is continuous and does not collapse
  into a solid U-shaped tray.
- Composite checks cover black, white, and Dock-dark backgrounds to catch
  halos and weak silhouette contrast.

## Runtime and packaging

- `src/main/index.ts` must not override the Dock icon at runtime.
- PierDev installs the canonical ICNS rather than regenerating a second
  geometry pipeline with `iconutil`.
- A layered CAR is installed only when its sidecar matches the committed Icon
  Composer document fingerprint and `assetutil` verifies the expected icon
  name and renditions.
- Development icon cache keys include the canonical sources, ICNS, Icon
  Composer document/fingerprint, and CAR.
- Release builds run an icon freshness gate before packaging and inspect the
  produced `.app` for `CFBundleIconName`, ICNS, and a valid `Assets.car`.

## Verification gates

1. Rasterize repository master/small/tiny at 1024/512/256, 128/64, and 32/16;
   compare decoded RGBA pixels with the approved canonical PNGs.
2. Parse ICNS/ICO/Linux PNG outputs and prove every size came from the intended
   optical source. Same-sized ICNS slots must have identical decoded pixels.
3. Verify alpha bounds, transparent hidden RGB, prompt geometry, and berth
   continuity at 16 and 32 px.
4. Compile and inspect the macOS 26 layered asset with `actool` and `assetutil`.
5. Build or brand a real PierDev.app bundle and inspect its plist and resources.
6. Render reference-versus-output comparison sheets and obtain independent
   visual, macOS-pipeline, and repository-governance reviews with no blocking
   findings.
