# ideall UI — building with this design system

shadcn-style React primitives (Radix UI + Tailwind v4) from **ideall**, an
open-source local-first personal-information terminal. All components are named
exports of the design-system bundle (`window.IdeallUI.*`); compound components
are composed from their named sub-parts.

## Setup & theming — no provider required

- **No global provider.** Theming is pure CSS custom properties shipped in
  `styles.css` (`:root` = light, `.dark` = dark). Render components directly —
  they read tokens from CSS. For dark mode, put `class="dark"` on an ancestor
  (e.g. `<html>`).
- **Radix overlays self-provide context** per root (`Dialog`, `Popover`,
  `Select`, `DropdownMenu`, `HoverCard`, `Sheet`). Two exceptions: wrap
  `Tooltip` usage in a single `TooltipProvider`, and render one `<Toaster />`
  near the app root, firing toasts with sonner's `toast()`.
- Every component accepts `className` (merged via tailwind-merge) for overrides.

## Styling idiom — Tailwind utilities over semantic tokens

Use standard Tailwind v4 utilities for layout. For color, ALWAYS use the design
system's **semantic token utilities** (never raw hex or palette classes like
`slate-500`) so light/dark and brand stay correct:

- Surfaces: `bg-background` `bg-card` `bg-popover` `bg-muted` `bg-accent`
- Text: `text-foreground` `text-muted-foreground` `text-card-foreground` `text-accent-foreground`
- Brand / primary action: `bg-primary` + `text-primary-foreground` (indigo). Custom key-action token: `bg-pop` + `text-pop-foreground`.
- Secondary: `bg-secondary` `text-secondary-foreground`
- Danger: `bg-destructive` `text-destructive-foreground`
- Lines & inputs: `border` `border-border` `border-input` `ring-ring`
- Category accents (small dots / tags / tints ONLY, never large fills): `text-spoke-info` (blue), `text-spoke-community` (green), `text-spoke-tool` (purple)

Radius: `rounded-lg` (1rem — the "bento" card radius) · `rounded-md` · `rounded-sm`.
House rules from the source design: **one primary action per screen**; reserve
`spoke-*` colors for small categorical accents only.

Variants are props (class-variance-authority), not classes:
`<Button variant="default|secondary|outline|ghost|destructive|link" size="default|sm|lg|icon">`,
`<Badge variant="default|secondary|destructive|outline">`,
`<Sheet><SheetContent side="top|right|bottom|left">`.

> The shipped `styles.css` (`@import "./_ds_bundle.css"`) is a fixed, pre-compiled
> stylesheet — no Tailwind runs at design time. Only utilities already present in
> it render. It carries a broad superset (every class the library + app use), but
> prefer the semantic tokens above and read the stylesheet before inventing class
> names.

## Compound components

Import the head plus its parts as named exports and compose:

- `Card` → `CardHeader` `CardTitle` `CardDescription` `CardContent` `CardFooter`
- `Dialog` → `DialogTrigger` `DialogContent` `DialogHeader` `DialogTitle` `DialogDescription` `DialogFooter` `DialogClose`
- `Select` → `SelectTrigger` `SelectValue` `SelectContent` `SelectGroup` `SelectLabel` `SelectItem` `SelectSeparator`
- `DropdownMenu`, `Tabs`, `Table`, `Command`, `Popover`, `HoverCard`, `Sheet`, `Tooltip` follow the same `<Name><NamePart>` pattern.

Each component's `<Name>.d.ts` is the prop contract; its `<Name>.prompt.md` shows usage.

## Idiomatic example

```tsx
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Button, Badge,
} from "window.IdeallUI"

<Card className="w-80">
  <CardHeader>
    <CardTitle>Local-first sync</CardTitle>
    <CardDescription>End-to-end encrypted across your devices.</CardDescription>
  </CardHeader>
  <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
    <Badge>Synced</Badge> Last update 2 min ago
  </CardContent>
  <CardFooter className="gap-2">
    <Button>Enable sync</Button>
    <Button variant="ghost">Later</Button>
  </CardFooter>
</Card>
```
