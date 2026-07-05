export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadTextFile(
  name: string,
  text: string,
  type = "application/json;charset=utf-8",
): void {
  downloadBlob(new Blob([text], { type }), name)
}
