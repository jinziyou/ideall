# design-sync notes — ideall UI

Project: **ideall UI** (`ea09cff9-31c7-4bd2-a7c5-9198336cabca`) · shape: `package` (synth/barrel).

## How this repo syncs (it's an app, not a published library)

- **No dist library build.** `ideall` is a Next.js app; the design system is the
  shadcn-style primitives in `src/ui`. The converter bundles a hand-written
  barrel `.design-sync/entry.ts` (passed via `--entry`), which re-exports the 21
  primitive modules. `window.IdeallUI.*` therefore carries every sub-export
  (`Card`, `CardHeader`, `DialogContent`, …) for the agent to import.
- **Card list is pinned**, not auto-discovered: `componentSrcMap` lists the 21
  family heads (Card, Dialog, Select, …) so the DS pane shows 21 cards, not one
  per sub-export. Adding a new primitive ⇒ add it to BOTH `entry.ts` and
  `componentSrcMap`.
- **Plate editor internals are excluded on purpose.** Any `src/ui/*.tsx` that
  imports `platejs` (the `*-node.tsx` files, `editor.tsx`, `inline-combobox.tsx`,
  `block-list.tsx`) and the whole `src/ui/editor/` subtree are NOT design-system
  components and are left out of both the barrel and the card list.

## CSS (the key mechanic)

- Component styling is Tailwind v4 utility classes resolved at build, so there is
  no static stylesheet to scrape. `.design-sync/compile-css.mjs` (wired as
  `cfg.buildCmd`) compiles one with `@tailwindcss/postcss`, scanning ONLY
  `src/ui` + `.design-sync/previews` (`source(none)` disables ambient
  auto-detection), and writes `.design-sync/.cache/tailwind.css` = `cfg.cssEntry`.
  **It must run before `package-build.mjs`.** `resync.mjs` runs `cfg.buildCmd`
  automatically; a manual build must run it first.
- Tokens: light (`:root`) + dark (`.dark`) live in `src/app/globals.css`. Custom
  "D 皮肤" tokens: `--pop`/`--flowback` (key-action indigo), `--spoke-*` (category
  dots only). Previews render light by default.

## Fonts / providers

- Fonts are **system stacks only** (`system-ui`, `PingFang SC`, `ui-monospace`) —
  no web fonts, no `@font-face`. A `[FONT_MISSING]` on a system family is a
  non-issue, not something to source.
- **No provider needed** — theming is pure CSS variables, so `cfg.provider` is
  unset. Radix overlays (Dialog/Popover/Select/DropdownMenu) self-provide context
  per root; `Tooltip` is composed inside `TooltipProvider` within its preview.

## Manual build/validate (re-sync is `resync.mjs`, which wraps this)

```sh
node .design-sync/compile-css.mjs
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules ./node_modules --entry .design-sync/entry.ts --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```

**Render check / playwright:** the validate render check needs a chromium that
matches the installed playwright. This machine's `~/.cache/ms-playwright` has
`chromium-1223`, which is pinned by **playwright 1.60.0** (the repo's own
`playwright@1.61.0` wants chromium-1228, NOT cached → would fail). So install
the matching version isolated in the staged dir on a fresh clone:
`(cd .ds-sync && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i esbuild ts-morph @types/react playwright@1.60.0)`.
If the cache changes, pick the playwright release whose `browsers.json` pins the
cached `chromium-<rev>`.

## Preview authoring conventions (carry forward)

- **English content only.** The Linux headless capture env may lack CJK fonts →
  Chinese text would render as tofu boxes and mis-grade. Components are
  language-agnostic, so previews use English realistic content.
- **Overlays render open in static capture.** Radix overlays use `open` /
  `defaultOpen` in the preview + `cfg.overrides.<Name> = {cardMode:single,
  primaryStory, viewport:"WxH"}`. Dialog/Sheet are CSS-positioned (overlay +
  centered/side content); Popover/DropdownMenu/HoverCard/Tooltip are Popper
  (position relative to trigger — all verified working). Command renders inline
  (cmdk, no portal). Tooltip must be wrapped in `TooltipProvider` in the preview.
- **Dialog footer** needs viewport width ≥ 640 so `sm:flex-row` gives the
  canonical side-by-side footer (below 640 it stacks reversed). Dialog viewport
  is 680.
- **Toaster ships a floor card on purpose.** Sonner's populated state is
  runtime-only (`toast()` fires it); a static preview shows an empty region, and
  triggering a toast would need a separate sonner instance (raw `import from
  'sonner'`), which would not be the DS's styled Toaster. The component is still
  fully importable/functional — designs use `<Toaster/>` + sonner's `toast()`.
- **CSS superset + previews.** `compile-css.mjs` scans all of `src` so the shipped
  CSS covers standard utilities; the orchestrator recompiles each wave to pick up
  preview-only arbitrary values (e.g. `w-[460px]`, `w-[560px]`). Fixed dates in
  Calendar keep its render deterministic.

## Known / accepted validate warns (re-sync must not treat as new)

- **`[FONT_MISSING]` for "Hiragino Sans GB", "Microsoft YaHei", "Cascadia Mono"** —
  ACCEPTED, do not ship. These are OS fonts at the *tail* of a `system-ui`-first
  stack (`--font-sans` / `--font-mono` in globals.css). The design is system-font
  based; there is no brand web font. Shipping proprietary OS fonts would be wrong.
  The DS pane renders with `system-ui` (first in the stack).

## Re-sync risks (watch-list)

- `compile-css.mjs` assumes `globals.css` keeps `@import "tailwindcss";` and its
  `:root`/`.dark` token layout. A globals refactor can silently change the
  compiled CSS — re-eyeball `.review.html` after any globals change.
- Utility classes used by an authored preview must appear in `src/ui` or another
  preview, else they won't be in the scanned CSS. Keep preview layout glue to
  common utilities.
- `componentSrcMap` + `entry.ts` are hand-maintained — new `src/ui` primitives do
  NOT auto-appear.
- Toolchain assumed: Tailwind v4 (`@tailwindcss/postcss`), React 19, Next 16;
  esbuild bundles with classic JSX (preview `.tsx` must `import * as React`).
