# Pier Canvas UI — Design Brief / Prompt Pack

> 把下面整段（或按「页面提示词」分段）粘贴进 Figma AI / Galileo / Uizard / v0 / Lovable / Midjourney 等 UI 设计工具。  
> 产品：Pier（本地 AI 开发工作台）。本包只覆盖 **Live Modules Canvas** 相关页面，不是整个 Pier 应用。

---

## Master system prompt（每次都先贴）

```text
You are designing UI for “Pier Canvas”, a live React preview system inside Pier (a local AI developer workbench for macOS).

PRODUCT CONTEXT
- Users open `.pier/canvases/**/*.canvas.tsx` files and see a Viewer panel.
- Three canvas kinds share ONE runtime:
  1) composition — design frames / scheme mockups (like Storybook Canvas / Figma Frame / Playroom)
  2) docs — visual documentation with live examples (like Storybook Docs)
  3) kit — global component catalog sourced from host `pier/canvas` (@pier/ui)
- Do NOT invent a separate Library marketplace UI in this brief (that is a later P-track). Focus on Viewer chrome + canvas page contents.

DESIGN LANGUAGE (must match Pier, not generic shadcn marketing)
- Desktop tool aesthetic: calm, dense, professional. Prefer VS Code / Linear / Raycast craft over Dribbble “AI SaaS”.
- Dark theme primary (+ light theme variant for each screen).
- Semantic surfaces: background, card/elevated, muted, border hairlines. No purple/indigo gradients, no glow, no glassmorphism, no emoji decoration, no heavy drop shadows.
- Interactive density: single-line controls = 28px tall. Icon buttons 28×28.
- Primary buttons: pill shape (fully rounded / rounded-full), not large rounded rectangles.
- Status colors via semantic badges: info / success / warning / danger / done / neutral — never rainbow.
- Typography: clear hierarchy (H1 ~28, H2 ~20, H3 ~15, body 14). Generous but disciplined spacing on 4/8px rhythm.
- Chinese + English UI ok; prefer short product language. Avoid engineering jargon in chrome (no “ticket”, no raw pier-live:// URLs in primary UI).

QUALITY BAR
- Every screen must pass a squint test: one primary focus.
- Mix open sections with cards; do not wrap every block in the same card.
- Show real content, not “Lorem / Placeholder / Coming soon”.
- Deliver: high-fidelity desktop frames (≈1280×800 or 1440×900), dark + light, with annotations for spacing and component names where helpful.
```

---

## Page inventory（必须全部出稿）

| ID | 页面 | 说明 |
|---|---|---|
| P0 | Viewer · composition | 宿主外壳 + 设计画板舞台 |
| P1 | Viewer · docs | 宿主外壳 + 阅读流舞台 |
| P2 | Viewer · kit | 宿主外壳 + 宽阅读流（目录页装在里面） |
| P3 | Viewer · loading | 编译中 |
| P4 | Viewer · empty/error | 无可展示 / 失败 + Reload |
| P5 | Kit catalog（canvas 内容） | 组件全集分类长页（01–08） |
| P6 | Kit · showcase hero（可选构图参考） | shadcn 首页式一屏漂浮展台（仅 kit 首页英雄区可选） |
| P7 | Docs · Button usage | 可视化文档模板页 |
| P8 | Composition · Checkout redesign | 结账方案设计画框 |
| P9 | Composition · Hello smoke | 最小冒烟页（仍要好看） |
| P10 | Overflow menu | 顶栏「···」：路径、复制模块 URL、在 Finder 显示等 |

---

## Per-page prompts（逐页粘贴）

### P0 — Viewer · composition

```text
Design Pier Canvas Viewer for kind=composition.

LAYOUT
- Dockview-style panel inside a desktop app (show a thin fake tab: “Checkout redesign”).
- Top chrome (40px): left = canvas title (from metadata) + small kind pill “composition”; right = icon-only Reload (28×28) + icon-only More (···). NO full file path, NO pier-live:// URL in the bar.
- Stage: muted artboard background (subtle checkerboard OR soft muted fill). Centered elevated frame/card (max-width ~880–960px) with 1px border, 8–12px radius, inner padding 20–24. Canvas content lives inside the frame.

CONTENT INSIDE FRAME (sample)
- Checkout redesign: order summary card, shipping options, primary “Continue” pill button, secondary outline actions, status badges Paid/Trial, a small local chip component.

ANNOTATE
- Chrome vs stage vs frame boundaries.
- Dark + light.
```

### P1 — Viewer · docs

```text
Design Pier Canvas Viewer for kind=docs.

Same chrome as P0, kind pill = “docs” (success/info semantic, not loud).

STAGE
- No checkerboard. Flat editor background.
- Centered reading column max-width ~720px, generous vertical rhythm (24–32 between sections).

CONTENT (Button usage docs)
- Eyebrow “DOCS”
- H1 “Button”
- Lead paragraph
- Rules list (When to use / Avoid)
- Live example blocks: Default / Outline / Destructive buttons in inset sample panels
- Variant matrix table-like rows: variant | when | sample

Dark + light.
```

### P2 — Viewer · kit

```text
Design Pier Canvas Viewer for kind=kit.

Same chrome, kind pill = “kit” (neutral).

STAGE
- No checkerboard. Wider reading column max-width ~960px.
- Hosts the long Kit catalog (see P5). Show the top of the catalog in this frame (hero + first two sections) and indicate scroll.

Dark + light.
```

### P3 — Viewer · loading

```text
Design Pier Canvas Viewer loading state.
- Same chrome with title skeleton or filename basename.
- Stage center: quiet “Compiling…” text or 28px-aligned spinner + short hint. No skeleton carnival. No blocking modal.
Dark + light.
```

### P4 — Viewer · empty / error

```text
Design Pier Canvas Viewer empty/error using Pier Empty pattern (not a red technical alert as the hero).
- Icon in muted well, title “Nothing to show” (or localized), description = human next step OR short error message.
- Outline Reload button (28px height, pill or rounded-md consistent with Pier outline buttons).
- Keep chrome visible.
Provide both: (a) invalid source (b) compile/runtime failure with muted technical detail under the hint.
Dark + light.
```

### P5 — Kit catalog page (full scroll)

```text
Design the Pier “Component kit” canvas content as a long scrollable catalog (NOT only a one-screen marketing collage).

PAGE STRUCTURE
01 Typography & layout — Text hierarchy, Stack/Row demo
02 Actions — Button variants (default/outline/secondary/ghost/destructive), 28px, rounded-full
03 Status — Badge semantic set + StatusIcon + Alert samples
04 Forms — Input+Label, Select, Checkbox, RadioGroup, Switch, ToggleGroup, Slider, Textarea (all 28px where single-line)
05 Feedback & empty — Progress, Skeleton, Spinner, Empty, Tooltip, Kbd
06 Navigation & structure — Tabs, Breadcrumb, Accordion, Item row
07 Overlays — HoverCard + Avatar (static open sample OK)
08 Data — compact Table + Card pricing sample

PAGE CHROME INSIDE CANVAS
- H1 “pier/canvas”
- Short lead
- Badges: 28px density · rounded-full Button · status tokens
- Section eyebrow 01…08, H2, lead, then samples in a responsive 2-col grid of small cards

CONSTRAINTS
- Looks like Pier settings quality, not Storybook addons marketplace.
- Show real labels (Email, Airplane mode, Account/Password).
- Dark + light; include a sticky mini TOC or top pill TOC.

Deliver at least 2 artboards: (1) top of page (2) mid-page forms section.
```

### P6 — Kit showcase hero (optional composition reference)

```text
Optional hero composition inspired by shadcn/ui homepage density: large left headline “Beautifully designed components for Pier canvases”, CTA pills, floating islands of RadioGroup, Switch+Continue, Dimensions popover form, Checkbox group, Tabs, HoverCard profile, Dropdown menu, Alert.

MUST remain Pier-flavored: 28px controls, rounded-full primary button, hairline borders, no marketing shadows/gradients.

This is a compositional reference for kit hero only; P5 remains the source of truth for completeness.
Dark background preferred.
```

### P7 — Docs · Button usage (full page content)

```text
Design the docs canvas page content (as seen inside Viewer docs stage).

Sections:
- Title + description
- “When to use” / “Avoid” rules
- Live examples in inset panels
- Variant guidance matrix
- Accessibility note (keyboard / disabled)

Tone: teaching, calm, documentation — not a marketing landing page.
Max width ~720. Dark + light.
```

### P8 — Composition · Checkout redesign

```text
Design a composition canvas (artboard frame content) for a checkout redesign.

Include:
- Page title + status badge
- Two-column on wide: order summary + payment/shipping
- Money rows, separator, tax/total
- Primary Continue (pill) + outline Back
- One Alert info about sync
- A small custom chip (“DemoChip”) to show project-local component alongside host kit

This is a DESIGN FRAME, not a production checkout app with real payments.
Shown inside the composition artboard from P0.
Dark + light.
```

### P9 — Composition · Hello smoke

```text
Design a minimal but polished smoke canvas:
- H2 “Smoke”
- Secondary line: pipeline ok; point users to kit/composition/docs templates
- Neutral badge “smoke only”
- Comfortable padding inside a narrow frame (max ~520)

Must feel intentional, not abandoned. Dark + light.
```

### P10 — Viewer overflow menu

```text
Design the More (···) menu attached to Viewer chrome:
- Show in Finder / Reveal
- Copy path
- Copy module URL (secondary, monospace hint)
- Reload
Use 28px min menu rows, separators, optional kbd hints. No destructive items unless Clear cache (if present, muted).
Dark + light.
```

---

## Deliverables checklist for the designer / tool

```text
Please output:
1. Design system notes: colors (map to background/card/muted/border/accent/status-*), type scale, 28px control spec, radius tokens.
2. All pages P0–P10 (P6 optional but recommended) in dark AND light.
3. Component annotations matching Pier names: Button, Badge, Input, Select, Tabs, Empty, etc.
4. Redlines for chrome height, stage padding, frame max-widths (composition 880–960 / docs 720 / kit 960).
5. Export: Figma frames or PNG/PDF set named P0…P10.
```

---

## Anti-goals（禁止）

```text
- Do not redesign the whole Pier IDE (sidebar, terminal, settings).
- Do not add a Canvas Library / marketplace / AI generate wizard in this pack.
- Do not use Inter/purple gradient AI-SaaS look.
- Do not put pier-live:// or absolute disk paths in the primary toolbar.
- Do not include FileTree, DiffView, Charts, or Dialog-heavy flows in the kit page.
```

---

## Reference analogues（气质参考，不要抄皮肤）

- Storybook Canvas / Docs layout rhythm
- shadcn/ui component gallery density (structure only)
- Figma Design System “Components” page information architecture
- Linear / Raycast settings density and quiet chrome
