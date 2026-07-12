/** Upper bound for text handed to a read-only editor when metadata includes the total size. */
export const TEXT_PREVIEW_LIMIT = 512 * 1024

export function textPreviewRange(
  readOnly: boolean,
  size: number | undefined,
): { start: number; end: number } | undefined {
  return readOnly && size !== undefined && size > TEXT_PREVIEW_LIMIT
    ? { start: 0, end: TEXT_PREVIEW_LIMIT }
    : undefined
}
