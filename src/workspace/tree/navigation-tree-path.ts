import { joinIdeallPath, type IdeallPath } from "@/filesystem/path"

/** Derive a descendant's canonical location in the navigation projection. */
export function navigationEntryPath(
  basePath: IdeallPath | undefined,
  pathName: string | undefined,
): IdeallPath | undefined {
  return basePath && pathName ? joinIdeallPath(basePath, pathName) : undefined
}

/** A navigation link remains selected while one of its descendants is active. */
export function isNavigationPathAtOrBelow(
  activePath: string | null | undefined,
  linkPath: IdeallPath | null | undefined,
): boolean {
  return Boolean(
    activePath && linkPath && (activePath === linkPath || activePath.startsWith(`${linkPath}/`)),
  )
}
