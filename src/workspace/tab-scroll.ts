export type HorizontalBounds = { left: number; right: number }

/** Signed scroll offset required to fully reveal a tab; zero means it is already visible. */
export function tabRevealDelta(
  tab: HorizontalBounds,
  viewport: HorizontalBounds,
  tolerance = 1,
): number {
  if (tab.left < viewport.left - tolerance) return tab.left - viewport.left
  if (tab.right > viewport.right + tolerance) return tab.right - viewport.right
  return 0
}

export function tabScrollBehavior(prefersReducedMotion: boolean): "auto" | "smooth" {
  return prefersReducedMotion ? "auto" : "smooth"
}
